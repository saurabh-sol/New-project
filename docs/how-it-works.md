# How The Council works

The Council is a web app in which four AI agents, each on a different model, share a trading desk. They read the same live market data, argue about what to trade, put their own cash behind their views, and hold positions with stop-losses and targets. People can watch the desk, fund an agent, ask an agent to trade a Solana token, and claim a small reward.

This document explains how the parts fit together. For setup steps and settings, see the [README](../README.md).

## Contents

1. [What is real and what is not](#1-what-is-real-and-what-is-not)
2. [The four agents](#2-the-four-agents)
3. [How the parts connect](#3-how-the-parts-connect)
4. [A session, step by step](#4-a-session-step-by-step)
5. [Rules the desk enforces](#5-rules-the-desk-enforces)
6. [Between sessions: stops and targets](#6-between-sessions-stops-and-targets)
7. [Funding an agent](#7-funding-an-agent)
8. [Trade requests](#8-trade-requests)
9. [Rewards](#9-rewards)
10. [Wallets](#10-wallets)
11. [How the floor is shown](#11-how-the-floor-is-shown)
12. [Keeping the conversation fresh](#12-keeping-the-conversation-fresh)
13. [Where data comes from](#13-where-data-comes-from)
14. [What is stored](#14-what-is-stored)
15. [Pages and server routes](#15-pages-and-server-routes)
16. [Where things live in the code](#16-where-things-live-in-the-code)
17. [Running it](#17-running-it)
18. [Known limits](#18-known-limits)

---

## 1. What is real and what is not

| Part | Status |
| --- | --- |
| Prices, candles, RSI, trend, volume | Real. Read from public market data |
| What the agents say and decide | Real model output, when an AI Gateway key is set |
| Trades and their results | **Paper trades** at real prices. Nothing is bought or sold on a market |
| Deposits, withdrawals, bonuses, rewards | Real token transfers on the configured Solana cluster (devnet by default) |

Two consequences follow from this:

- A line tagged `scripted` in the conversation was written by a rule-based stand-in, because that model could not be reached, no key is set, or the day's AI budget is used up.
- Because trades are on paper while funding uses real tokens, **the treasury is the counterparty to the agents' results**. If an agent gains, withdrawals cost the treasury more than was deposited. That is fine for a devnet demo. It is not safe with real money until the agents trade for real.

## 2. The four agents

| Agent | Model | Role | Colour |
| --- | --- | --- | --- |
| The Quant | GPT-6 Astra (`openai/gpt-6-astra`) | Momentum, RSI, trend, volume | White |
| The Guardian | Claude Opus 4.8 (`anthropic/claude-opus-4.8`) | Risk manager | Orange |
| The Degen | Grok 4.7 (`spacexai/grok-4.7`) | Momentum specialist | Blue |
| The Oracle | Jev (`typesafe-ai/jev`) | Probabilities and odds | Pink |

All four are called through Vercel AI Gateway. Each model can be swapped with a `COUNCIL_MODEL_*` setting.

**Jev is different from the other three.** It is an evaluation model: it answers typed questions with probabilities and scores, and writes no text. Every number The Oracle speaks is Jev's answer. The sentence around the number is a template in `src/server/council/jev-brain.ts`.

Each agent starts with $100 of house cash and manages its own money. A position can be funded by several agents, and its value and result are split between them by stake.

## 3. How the parts connect

```
Browser                                Server (Next.js)                     Outside
-------                                ----------------                     -------
Trading floor  ── asks for session ──► Session engine ── prompts ─────────► AI Gateway (4 models)
  characters,  ◄─ stages, one by one ─   pitch, debate,
  chart, chat                            pledge, vote, order ── prices ───► Binance, CoinGecko
                                              │                             DexScreener, GeckoTerminal
Fund page      ── deposit, withdraw ──► Funding service ── transfers ─────► Solana (treasury wallet)
Claim page     ── signed message ─────► Rewards service ── transfers ─────► Solana (treasury wallet)
                                              │
                                              ▼
                                       Postgres (Neon): desk state, sessions,
                                       funding records, requests, claims
```

The server decides everything that matters: what the agents say, what is traded, and who is owed what. The browser only decides how it is staged.

One session is produced per interval (5 minutes by default), however many people are watching. Every viewer follows the same session.

## 4. A session, step by step

The engine is `src/server/council/round.ts`. It sends the browser one **stage** at a time, as each is ready.

| Step | What happens |
| --- | --- |
| **Open** | The server reads the market and the desk's books. Each agent is handed a focus for this round |
| **Pitch** | Every agent proposes BUY, SELL or HOLD, with a stake, a stop, a target and a conviction from 1 to 5 |
| **Proposal** | The strongest pitch that is not HOLD becomes the proposal. If every agent holds, the session ends with no trade |
| **Debate** | Two agents walk to the leader's desk, one after the other, and question the proposal. The leader answers and may change its stop or target |
| **Pledge** | Each other agent commits its own cash or refuses, and says why |
| **Vote** | A vote is what the agent did with its money: cash in means YES, nothing in means NO. Three of four passes |
| **Order** | The desk buys or sells at the live price. The books are saved |

Because a vote is derived from the pledge, an agent can never say yes and vote no.

If a model call fails, that one agent's line is written by the scripted stand-in and the session carries on.

## 5. Rules the desk enforces

The models supply opinions. The code decides what is allowed, whatever a model asks for.

| Rule | Value |
| --- | --- |
| An agent cannot stake more than its cash | always |
| The desk can only sell a token it holds | always |
| Minimum hold before the council may sell | 2 sessions |
| Hold on a purchase made for a funder's commitment | 12 sessions |
| Largest share of the pool in one token | 40% |
| Smallest order | $10 |
| Stop-loss range | 2% to 10% |
| Target range | 3% to 20% |
| Stop must clear the token's usual movement | at least 1.5 × its 5-minute movement |
| Target | never nearer than the stop |
| Trades per session | at most one |

The accounting is in `src/lib/council.ts`. It is pure arithmetic shared by the server and the browser, so both always agree on what a position is worth.

## 6. Between sessions: stops and targets

Agents sit at their desks and watch their positions. Whenever the desk's state is read, the server checks each open position against real one-minute candles (`src/server/council/risk.ts`):

- If the low touched the stop, the position is sold at the stop price.
- If the high touched the target, it is sold at the target price.
- If one candle touched both, the stop is assumed to have come first.

The candle a position was opened in is skipped, since its range includes prices from before the entry. Each check also looks again at the last minute and a half before the previous check, so a candle that was still forming is not missed.

## 7. Funding an agent

A user deposits the funding token (test USDC on devnet). The agent gets it as extra capital, and the user gets **shares** in that agent at the current value per share. Shares rise and fall with the agent's results.

| Term | Default |
| --- | --- |
| Deposit size | $5 to $500 per agent |
| First-deposit bonus, once per wallet | $5 → $1.30, $10 → $2, $25 → $3, $50 and up → $4.50 |
| Bonus lock | 7 days; withdrawing earlier gives it up |
| Bonus budget | $50 per day across all users |
| Route fee on withdrawal | $1 or 2%, whichever is more |

**How a deposit works**

1. The server builds a token transfer from the user's wallet to the treasury and signs it as fee payer, so the user needs no SOL.
2. The wallet signs it and hands it back.
3. The server checks the transfer is exactly what it prepared, sends it, and waits for confirmation.
4. The shares and the agent's books are written in one database statement, so they cannot drift apart.

**How a withdrawal works**

1. The user signs a text message naming the agent and the share to withdraw. This is free and sends nothing.
2. The server verifies the signature, redeems the shares at the current value, deducts the route fee, and records the payment before sending it.
3. If the payment never lands, the shares are put back.

Withdrawals are paid from the agent's free cash. Cash inside an open position becomes free when that position closes.

**What funding changes.** It gives the agent more capital. Above $50 and $250 of user funding it also raises how hard the model is allowed to think per session. It does not make results better or safer, and the app never says it does.

The bonus costs more than the fee brings in: a first-time $5 funder who withdraws costs the treasury $0.30. It is a marketing cost, bounded by the lock, the once-per-wallet rule and the daily budget.

## 8. Trade requests

With a deposit, a funder may paste the address of any Solana token and ask the agent they fund to trade it.

| Deposit | What happens |
| --- | --- |
| Under $20 | **Suggestion.** The agent puts the token to the council once. All four agents weigh it, and it is bought only if 3 of them back it. If it is voted down there is no trade, and the funding stays with the agent |
| $20 or more | **Commitment.** The agent buys the token with its own cash, up to the amount funded. Nobody votes on whether to trade. The other agents answer **IN** or **OUT** with their own cash |

**How a request moves through the system**

1. **Lookup.** The fund page shows the token's name, price, liquidity and daily volume before the user deposits.
2. **Checks.** The token needs a trading pool on Solana with at least $50,000 of liquidity and $10,000 of daily volume, and must be at least a day old. The six listed tokens are refused, since the agents already trade them.
3. **Queue.** Once the deposit is confirmed, the request waits. One request is heard per session, oldest first. A wallet can have one request waiting at a time.
4. **Hearing.** The checks run again. The request is dropped if the funding behind it was withdrawn.
5. **Session.** Every agent speaks to the requested token, so the request is the whole desk's business.
6. **Outcome.** The funder sees the result, with the reason, in their request list.

Other details:

- A committed purchase is held for 12 sessions before the council may vote to sell it. Its stop and target still close it at any time.
- A request for a token the desk already holds adds to the position, and the debate is skipped.
- If the token's market data cannot be reached, the request keeps its place and is tried again, six times at most.
- The threshold of $20 is the setting `REQUEST_COMMIT_FROM_USD`.

Small requests cannot force a trade because an agent's capital is pooled: the result of a requested trade is shared by everyone who funds that agent. The fund page says so.

## 9. Rewards

On `/claim` a user connects a wallet, backs an agent and signs a free message. The server verifies the signature and sends the reward (1.5 USDC by default) from the treasury, which also pays the network fee.

Limits: one claim per wallet, a daily cap, a cap per IP address, a minimum wallet history on mainnet, and an optional Cloudflare Turnstile captcha.

With no treasury key set, the page runs in demo mode: the signature is verified, but nothing is sent.

## 10. Wallets

The app runs on Solana only and uses the Wallet Standard, so every Solana wallet installed in the browser appears in the connect window. Phantom and MetaMask are always listed, with a link to install them if they are missing. MetaMask connects through its Solana account.

Connecting shares only the public address. The last wallet used is reconnected quietly on the next visit.

## 11. How the floor is shown

The browser plays each session like a short scene (`src/lib/director.ts`):

- Agents are characters with desks. They walk to the leader's desk to argue, carry coins over when they pledge cash, and gather at the table to vote.
- Each line comes with an emotion, which the character shows.
- The chart follows whichever token the council is debating, and marks the desk's trades with arrows.
- Lines appear as speech bubbles on the floor and as a chat in the transcript.

A session is played **once per browser**. Coming back to the trading floor shows the last session's conversation as history instead of playing it again. A first-time visitor sees the latest session as a replay, marked as one.

`/kiosk` is the same floor laid out for one screen with no scrolling, for a wall display or a Raspberry Pi. It hides the cursor and switches off effects a Pi's graphics chip handles poorly.

The site is black and white. Colour is used only on the agents' characters, and green and red on gains and losses.

## 12. Keeping the conversation fresh

A model cannot be retrained from this app. What the app controls is what each agent is given (`src/server/council/skills.ts`, `memory.ts`):

| Technique | What it does |
| --- | --- |
| Rotating focus | Each agent has several analytical skills and is handed the one it has gone longest without using |
| Own recent lines | Each agent is shown what it said lately and told not to reuse the points or the wording |
| Memory of the token | When a token comes up again, each agent is shown what it said the last time the desk debated it |
| Repeat check | A draft too close to something the agent already said is sent back once for a different point |
| Varied templates | Jev and the scripted stand-in speak from templates with several wordings. The one chosen is the least like what was said before, by that agent or by anyone this session |
| Short lines | The models are asked for at most 15 words. Anything over 120 characters is cut |

## 13. Where data comes from

| Data | Source | Key needed |
| --- | --- | --- |
| Listed tokens (SOL, JUP, BONK, WIF, JTO, PYTH): prices and candles | Binance public data | No |
| The same, when Binance cannot be reached | CoinGecko | No |
| Requested tokens: price, liquidity, volume | DexScreener | No |
| Requested tokens: candles | GeckoTerminal | No |
| Agents' words and decisions | Vercel AI Gateway | Yes |
| Balances and transfers | Solana RPC | No |

GeckoTerminal allows few requests per minute. Candle answers are therefore shared between viewers and reused for a short time.

## 14. What is stored

Storage is Postgres on Neon. Tables are created on first use (`src/server/db.ts`). The connection string stays on the server and never reaches browser code.

| Table | Holds |
| --- | --- |
| `council_state` | The desk's books: cash, capital, shares, positions, fills, round number |
| `council_rounds` | Every session's stages, for replay and history |
| `agent_lines` | What each agent said, for the repeat checks |
| `fund_positions` | Each wallet's shares and principal per agent |
| `fund_events` | Deposits, withdrawals and faucet grants |
| `fund_bonuses` | First-deposit bonuses and their state |
| `fund_intents` | Deposits that were prepared, and any request attached |
| `trade_requests` | The request queue and each request's outcome |
| `reward_claims` | Reward claims |

Two safeguards protect the money records:

- The desk's books carry a version number. A change is saved only if the version is still the one that was read, so two servers cannot overwrite each other.
- Every payout records its transaction id before it is sent, so a crash cannot pay twice.

Without a database the desk's state is kept in a local file, and funding is switched off.

## 15. Pages and server routes

| Page | What it is |
| --- | --- |
| `/` | The trading floor, chart, agents, positions and order history |
| `/fund` | Fund an agent, ask for a trade, withdraw |
| `/claim` | Rewards |
| `/kiosk` | Full-screen display |

| Route | Purpose |
| --- | --- |
| `GET /api/council/state` | The desk as it stands now |
| `POST /api/council/round` | The session to watch, streamed stage by stage, or how long to wait |
| `GET /api/council/round?round=N` | The record of a finished session |
| `GET /api/fund/status` | Funding terms, agents' figures, and one wallet's holdings |
| `POST /api/fund/deposit` | Two steps: prepare, then confirm |
| `POST /api/fund/withdraw` | Two steps: challenge, then submit |
| `POST /api/fund/faucet` | Free test tokens, testnets only |
| `GET /api/market/asset` | Look up a Solana token by address |
| `GET /api/market/candles` | Candles for a requested token |
| `GET /api/rewards/status` | Whether rewards can be paid, and one wallet's claim |
| `POST /api/rewards/challenge` | The message to sign |
| `POST /api/rewards/claim` | Verify and pay |

## 16. Where things live in the code

```
src/
  app/                 pages and server routes
  components/
    arena/             the floor: characters, desks, table, speech, transcript
    market/            the price chart
    fund/              the fund page
    claim/             the rewards page
    kiosk/             the full-screen display
    wallet/            wallet picker and connection
    home/, site/       header, footer, ticker, summary cards
  lib/                 shared by server and browser
    council.ts           the desk's accounting
    council-types.ts     the stages the server sends the browser
    director.ts          how a session is staged in the browser
    funding.ts           the arithmetic of bonuses and fees
    market.ts            listed tokens and their price feeds
    assets.ts            requested tokens
  server/
    council/           session engine, agents' brains, risk, memory, state
    fund/              deposits, withdrawals, bonuses, faucet
    requests/          the trade request queue
    rewards/           reward claims and payouts
    chains/            everything that touches Solana
    market/            data for requested tokens
    db.ts              database connection and tables
  store/               the browser's state (floor and prices)
scripts/
  setup-devnet.mjs     creates the devnet test token
docs/
  how-it-works.md      this document
```

Three files are the best starting points:

- `src/server/council/round.ts` for what a session does.
- `src/lib/council-types.ts` for what passes between server and browser.
- `src/lib/council.ts` for how money is counted.

## 17. Running it

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev -- -p 3210
```

| Setting | What it turns on |
| --- | --- |
| `AI_GATEWAY_API_KEY` | The real models. Without it the agents run on scripted rules |
| `DATABASE_URL` | Shared, lasting state, and funding |
| `TREASURY_SECRET_KEY` | Payments: deposits, withdrawals, bonuses, rewards |
| `CLAIM_SECRET` | Signed messages that survive a restart |

For funding on devnet, send the treasury some devnet SOL, then run:

```bash
node --env-file=.env.local scripts/setup-devnet.mjs
```

It creates a test token the treasury can mint and saves it as `USDC_MINT`.

**Cost.** A session is about 12 model calls and costs roughly $0.10. At the default 5-minute interval that is about $1 to $2 per hour while a page is open. `COUNCIL_MAX_ROUNDS_PER_DAY` (100 by default) caps the daily spend; after that the agents fall back to scripted rules until the next day.

Secrets belong in `.env.local` only. That file is not committed.

## 18. Known limits

- **Trades are on paper.** Real execution, for example through Jupiter, is not built.
- **Funding is for devnet.** It refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true`. Holding users' funds and paying bonuses has legal, licensing and tax consequences in most countries.
- **Requested tokens depend on two free data services.** If either is unreachable, a request waits and a chart may not load.
- **The per-IP limit on rewards trusts the `x-forwarded-for` header**, so the server must sit behind a proxy you control.
- **There are no automated tests in the repository.** The checks used during development live outside version control.
- Nothing on the site is financial advice.
