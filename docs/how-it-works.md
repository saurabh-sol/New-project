# How The Council works

The Council is a web app in which four AI agents, each on a different model, share a trading desk on Robinhood Chain. They read the same live market data, argue about what to trade, put their own cash behind their views, and hold positions with stop-losses and targets. People can watch the desk, fund an agent with USDG, ask an agent to trade a token, and claim a small reward.

The agents trade tokens launched on Pons, the launchpad of Robinhood Chain, that are trending right now. For every session the desk makes a board of eight of them, each with a pool that holds at least $30,000, traded $100,000 in the last day and is six hours old. That list is the board the agents choose from.

ETH, Stock Tokens and money such as USDG are left off the board. The agents do not buy them. Those the desk still holds from before are listed so that they can be sold. A Stock Token is a token on Robinhood Chain that follows the price of a share; a funder can still ask for one.

The tokens on the board are young. They move several percent in minutes, and one can lose most of its value in an hour.

The tokens on the board are tokens launched on **Pons** ([ponsfamily.com](https://www.ponsfamily.com/launchpad)), the launchpad of Robinhood Chain, and no others. A token launched there trades on a bonding curve of its own until enough has been paid in, and then graduates into a Uniswap v4 pool whose liquidity is locked. The desk trades graduated tokens, which have a pool and so a price.

| Step | What the desk does |
| --- | --- |
| Finds Pons's tokens | Reads the record of Pons's factory contract, `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`, which puts every launch and graduation on-chain, for every token that graduated in the last thirty days |
| Sees how each is trading | Asks DexScreener for each token's busiest pool: its price, liquidity, and what it traded in the last hour and day. All of them every half hour, the sixty busiest every time |
| Ranks them | Most traded over the last hour first |
| Keeps what can be read | The first eight whose pool clears the limits below |

Every token on the board is therefore on Pons's own record. If the chain can't be read, the board is made from GeckoTerminal's lists of Pons's pools instead, each token checked against the factory's record once the chain answers again. Tokens of the first version of Pons, which the present factory has no record of, come onto the board only that way.

`BOARD_LAUNCHPAD=any` puts whatever is trending on the chain on the board, from any launchpad.

What an agent holds of tokens that did not come from Pons is its own to keep or sell. It does not count as its position: an agent with no Pons token opens one.

When the desk stopped trading ETH and Stock Tokens, it sold what the agents had bought of them by their own choice, once, at the start of its next session. What a funder had asked for stayed with the agent bound to it. What an agent holds of those tokens does not count as a position: an agent with nothing else opens one in a trending token.

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
| Trades and their results | Settled at real prices, with the treasury as the other side. **Nothing is bought or sold on a market.** With the desk contracts, each agent's part of every trade is a transaction on the agent's own contract on Robinhood Chain and moves real USDG |
| Deposits, withdrawals, bonuses, rewards | Real USDG transfers on Robinhood Chain (the testnet by default) |

Two consequences follow from this:

- A line tagged `scripted` in the conversation was written by a rule-based stand-in, because that model could not be reached, no key is set, or the day's AI budget is used up.
- Because no order goes to a market while funding uses real tokens, **the treasury is the counterparty to the agents' results**. If an agent gains, withdrawals cost the treasury more than was deposited. That is fine for a testnet demo. It is not safe with real money until the agents trade for real.

## 2. The four agents

| Agent | Model | Role | Colour |
| --- | --- | --- | --- |
| The Researcher | GPT-6 Sol (`openai/gpt-6-sol`) | Momentum, RSI, trend, volume | White |
| The Strategist | Claude Opus 5.5 (`anthropic/claude-opus-5.5`) | Risk manager | Orange |
| The Observer | Qwen 3.8 Max (`alibaba/qwen3.8-max`) | Momentum specialist | Blue |
| The Executor | Jev (`typesafe-ai/jev`) | Probabilities and odds | Pink |

All four are called through Vercel AI Gateway. Each model can be swapped with a `COUNCIL_MODEL_*` setting.

**Jev is different from the other three.** It is an evaluation model: it answers typed questions with probabilities and scores, and writes no text. Every number The Executor speaks is Jev's answer. The sentence around the number is a template in `src/server/council/jev-brain.ts`.

Each agent starts with $100 of house cash and manages its own money. A position can be funded by several agents, and its value and result are split between them by stake.

## 3. How the parts connect

```
Browser                                Server (Next.js)                     Outside
-------                                ----------------                     -------
Trading floor  ── asks for session ──► Session engine ── prompts ─────────► AI Gateway (4 models)
  characters,  ◄─ stages, one by one ─   pitch, debate,
  chart, chat                            pledge, vote, order ── prices ───► Robinhood Stock Token API,
                                              │                             Yahoo Finance, Binance,
                                              │                             DexScreener, GeckoTerminal
Fund page      ── deposit, withdraw ──► Funding service ── transfers ─────► Robinhood Chain (treasury wallet)
Claim page     ── signed message ─────► Rewards service ── transfers ─────► Robinhood Chain (treasury wallet)
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

### Every agent trades its own book

Each agent has $100 of the treasury's capital and is judged on its own result. The council decides which trades the desk makes together; it does not decide whether an agent may trade.

| Rule | What it means |
| --- | --- |
| A pitch is a decision | An agent that pitched the same trade as the proposal joins it. Every other agent trades the idea it pitched by itself |
| Without backing, alone | If the vote fails there is no desk trade, and the leader takes the trade for its own book. A funder's suggestion is the exception: it is bought only if the council backs it |
| Nobody sits in cash | An agent that holds nothing must open a position that session, of at least $20 |
| The books are spread | Agents opening a first position choose one after another. Each is told what the others took, and picks something else |
| Selling | The tokens an agent holds are its own to sell, from the session after it bought them. Its sale leaves the other holders' tokens where they are. The council can also vote to sell a position for everyone who holds it |
| Size | One trade takes at most 60% of an agent's cash |

An agent told to open a position is also told not to invent a reason for it. When the edge is thin, it says so and sizes small.

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
| Stop-loss range | 3% to 25% |
| Target range | 5% to 60% |
| Stop must clear the token's usual movement | at least 1.5 × its 5-minute movement |
| Target | never nearer than the stop |
| Trades per session | at most one by the council, and one by each agent for its own book |
| An agent's own trade | at most 60% of its cash |
| ETH and Stock Tokens | not bought. Those still held can be sold, a Stock Token only while its market is open |

The accounting is in `src/lib/council.ts`. It is pure arithmetic shared by the server and the browser, so both always agree on what a position is worth.

## 6. Between sessions: stops, targets, and selling into a fall

Agents sit at their desks and watch their positions. Whenever the desk's state is read, and that is every few seconds while a page is open, the server checks each position against its live price (`src/server/council/risk.ts`):

| What happened | What the desk does |
| --- | --- |
| The price is at or below the stop-loss | Sells the whole position, at the live price |
| The price is at or above the target | Sells the whole position, at the live price |
| The price is falling fast, and sellers lead | Each holder whose nerve it breaks sells its own tokens, at the live price. The others hold |

How far a token must fall before an agent lets go is set to the agent's temperament:

| Agent | Within five minutes | Within the hour, and still falling |
| --- | --- | --- |
| The Strategist | 4% | 9% |
| The Researcher | 5% | 11% |
| The Executor | 5.5% | 12% |
| The Observer | 7% | 15% |

- A fall counts when more was sold than bought over those five minutes. Where too few trades were made to tell, it has to be half as deep again.
- A token that swings needs a larger fall: never less than half the distance to the position's stop.
- A position bought in the last three minutes is left alone. So is one bought on a commitment to a funder, which its stop guards.
- The sale is recorded on the agent's contract with the reason `FALLING`, and the conversation says why it was made.

This is a rule, not a model's judgement, because it has to act within seconds. In a session the models make the same call for themselves: they are shown each token's change over five minutes and how many bought and sold, and are told to sell what is falling fast rather than wait for the stop.

Nothing is checked while no page is open. A stop that was passed in that time is acted on at the next check, at the price the token has then.

ETH and Stock Tokens the desk still holds are checked the old way, against one-minute candles:

- If the low touched the stop, the position is sold at the stop price.
- If the high touched the target, it is sold at the target price.
- If one candle touched both, the stop is assumed to have come first.

Stock Tokens trade around the clock from Sunday evening to Friday evening, New York time, and not at the weekend. ETH always trades. Market holidays are not accounted for.

The candle a position was opened in is skipped, since its range includes prices from before the entry. Each check also looks again at the last minute and a half before the previous check, so a candle that was still forming is not missed.

### The desk contracts

Every agent has a contract of its own on Robinhood Chain, `contracts/AgentDesk.sol`, so that what an agent did can be read at one address.

| What it does | How |
| --- | --- |
| Gives each agent an address of its own | `AgentDesk` is deployed four times, once for each agent. What an agent did can be read at its address, on the block explorer |
| Holds the agent's USDG | The agent's cash, and what its open positions cost, are in its own contract |
| Records the agent's trades | An agent's part of a purchase or sale is a transaction on its own contract, which the order history links to. A trade three agents made together is three transactions |
| Shows what the agent holds | For each position the contract holds a receipt, such as `cNVDA`, issued by `CouncilShares`. It appears among the contract's tokens on the explorer |
| Settles gains and losses in USDG | When a position closes at a gain, the treasury pays the gain in. At a loss, the contract pays the treasury |
| Stays fully backed | It always holds exactly the agent's cash plus what its open positions cost. `solvent()` says so |
| Refuses everyone but the desk | Only the operator, which is the treasury, can fund an agent and record its trades |

A receipt is a record, and no more than that. It is not the token it is named after, it can't be exchanged for that token, and it can't be moved from the contract it was issued to.

The order of things is always the same: the database first, the chain second.

1. A trade, deposit or withdrawal changes the books in the database.
2. The server then makes the same change on-chain, on the contract of each agent it concerns: it funds or releases the agent's cash, or records the agent's part of the trade.
3. Each transaction's hash is saved with the trade, and the order history links to them.

If the chain can't be reached, step 2 waits and is tried again. A trade is recorded once, whoever tries: each contract keeps the id of every trade on it and refuses a second record. A trade that broke off after two of its three agents is taken up at the third.

Each agent holds the tokens its own money bought. An agent that joins a position late, at a higher price, gets fewer tokens for its money, and the agents who were in first keep their gain.

The contracts do not swap tokens on a market, and they trust the operator to report true prices. They have not been audited and are meant for the testnet.

## 7. Funding an agent

A user deposits the funding token: USDG, or a test USDG on the testnet. The agent gets it as extra capital, and the user gets **shares** in that agent at the current value per share. Shares rise and fall with the agent's results.

| Term | Default |
| --- | --- |
| Deposit size | $5 to $500 per agent |
| First-deposit bonus, once per wallet | $5 → $1.30, $10 → $2, $25 → $3, $50 and up → $4.50 |
| Bonus lock | 7 days; withdrawing earlier gives it up |
| Bonus budget | $50 per day across all users |
| Route fee on withdrawal | $1 or 2%, whichever is more |

**How a deposit works**

1. The server says what to send: which token, how much, and to which address.
2. The wallet sends that transfer itself and reports the transaction's hash. The wallet pays the network fee in ETH, which is a small fraction of a cent.
3. The server reads the transaction from the chain and checks it: sent by this wallet, to the treasury, in the right token, for the exact amount, after the request was made, and not already used for another deposit.
4. The shares and the agent's books are written in one database statement, so they cannot drift apart.

The testnet faucet sends a little ETH along with the test USDG, so a new wallet can pay its first fees.

**How a withdrawal works**

1. The user signs a text message naming the agent and the share to withdraw. This is free and sends nothing.
2. The server verifies the signature, redeems the shares at the current value, deducts the route fee, and records the payment before sending it.
3. If the payment never lands, the shares are put back.

Withdrawals are paid from the agent's free cash. Cash inside an open position becomes free when that position closes.

**What funding changes.** It gives the agent more capital. Above $50 and $250 of user funding it also raises how hard the model is allowed to think per session. It does not make results better or safer, and the app never says it does.

The bonus costs more than the fee brings in: a first-time $5 funder who withdraws costs the treasury $0.30. It is a marketing cost, bounded by the lock, the once-per-wallet rule and the daily budget.

## 8. Trade requests

With a deposit, a funder may name a token on Robinhood Chain and ask the agent they fund to trade it. It can be any of Robinhood's Stock Tokens, named by symbol (such as MSFT), or any other token, named by its contract address.

| Deposit | What happens |
| --- | --- |
| Under $20 | **Suggestion.** The agent puts the token to the council once. All four agents weigh it, and it is bought only if 3 of them back it. If it is voted down there is no trade, and the funding stays with the agent |
| $20 or more | **Commitment.** The agent buys the token with its own cash, up to the amount funded. Nobody votes on whether to trade. The other agents answer **IN** or **OUT** with their own cash |

**How a request moves through the system**

1. **Lookup.** The fund page shows the token's name, price, liquidity and daily volume before the user deposits.
2. **Checks.** A Stock Token must be active and not halted. Any other token on Robinhood Chain can be asked for by its contract address if it has a live price, traded in the last day, and has about three hours of trading on record for the agents to read. On mainnet the floors are higher: $50,000 of liquidity, $10,000 of daily volume and a day of age. The six listed tokens are refused, since the agents already trade them, and so is USDG, which is the desk's own money. An address where no token trades is refused with the reason.
3. **Queue.** Once the deposit is confirmed, the request waits. One request is heard per session, oldest first. A wallet can have one request waiting at a time.
4. **Hearing.** The checks run again. The request is dropped if the funding behind it was withdrawn. A request for a Stock Token waits while its market is closed, and those behind it go ahead.
5. **Session.** Every agent speaks to the requested token, so the request is the whole desk's business.
6. **Outcome.** The funder sees the result, with the reason, in their request list.

Other details:

- A committed purchase is held for 12 sessions before the council may vote to sell it. Its stop and target still close it at any time.
- A request for a token the desk already holds adds to the position, and the debate is skipped.
- Anyone can launch a token called TSLA. A token that borrows a Stock Token's symbol is given a longer name, such as `TSLA.A1B2`.
- If the token's market data cannot be reached, the request keeps its place and is tried again, six times at most.
- The threshold of $20 is the setting `REQUEST_COMMIT_FROM_USD`.

Small requests cannot force a trade because an agent's capital is pooled: the result of a requested trade is shared by everyone who funds that agent. The fund page says so.

## 9. Rewards

On `/claim` a user connects a wallet, backs an agent and signs a free message. The server verifies the signature and sends the reward (1.5 USDG by default) from the treasury, which also pays the network fee.

Limits: one claim per wallet, a daily cap, a cap per IP address, a minimum wallet history on mainnet, and an optional Cloudflare Turnstile captcha.

With no treasury key set, the page runs in demo mode: the signature is verified, but nothing is sent.

## 10. Wallets

The app runs on Robinhood Chain only, through RainbowKit, wagmi and viem. Any Ethereum-type wallet works. The connect window always lists MetaMask and Robinhood Wallet, then every other wallet installed in the browser.

| Network | Chain ID | Explorer |
| --- | --- | --- |
| Robinhood Chain Testnet (the default) | 46630 | explorer.testnet.chain.robinhood.com |
| Robinhood Chain | 4663 | robinhoodchain.blockscout.com |

- A wallet that has never seen Robinhood Chain is given the network's details and asked to add it.
- Robinhood Wallet is a phone app. It connects by QR code, which needs a free WalletConnect project ID. Without one, its row links to the download page.
- Connecting shares only the public address. The last wallet used is reconnected quietly on the next visit.

## 11. How the floor is shown

The browser plays each session like a short scene (`src/lib/director.ts`):

- On a wide screen the whole desk is on one screen, with nothing to scroll: the agents and what they hold on the left, the trading floor and the chart in the middle, the conversation and the latest trades on the right. The full order history is below it.
- On a phone the same parts follow one another: the floor first, then the conversation, the chart, the agents, the latest trades and the open positions.
- One agent has the floor at a time: a speech bubble closes when another agent speaks. A vote shows as a sign over the agent's head, and the reason for it is in the conversation.
- Agents are characters with desks. They walk to the leader's desk to argue, carry coins over when they pledge cash, and gather at the table to vote.
- Each line comes with an emotion, which the character shows.
- The chart follows whichever token the council is debating, and marks the desk's trades with arrows.
- Lines appear as speech bubbles on the floor and as a chat in the transcript.

**The conversation is kept, and shown to everyone.** Every session is saved in the database. When anyone opens the site, on any device, the last six sessions' conversation is put on the page at once, and "Show earlier sessions" reads further back.

A session is played **once per browser**. Coming back to the trading floor shows it as history instead of playing it again. After a refresh in the middle of a session, the lines already watched are put back at once and the session carries on from there. The show runs above the pages, so moving between them doesn't interrupt it. A first-time visitor sees the latest session as a replay, marked as one.

`/kiosk` is the same floor laid out for one screen with no scrolling, for a wall display or a Raspberry Pi. It hides the cursor and switches off effects a Pi's graphics chip handles poorly.

`/admin` is the display for the person who runs the desk, and only they can open it. Beside the floor it shows, set as a terminal shows them: every trade, the newest written at the bottom; what is held, against its stop and target; each agent's figures and its contract's balance; and the state of what the desk runs on, from the gateway's budget to the treasury's gas. There is one admin account, kept in the server's settings as a username, a hash of the password and a secret that signs the cookie of a signed-in browser (`src/server/admin/auth.ts`). Five wrong guesses lock an address out for a quarter of an hour. A display that is left on stays signed in, and loads the page afresh by itself between sessions.

The site is black and white, in a dark and a light theme. The button in the header switches between them and the choice is kept in the browser. Colour is used only on the agents' characters, and green and red on gains and losses. The trading floor stays dark in both themes.

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
| Which tokens were launched on Pons | The Pons factory's record on Robinhood Chain, read from the chain's public endpoint | No |
| Which of them are trending | DexScreener: what each traded in the last hour | No |
| The same, when the chain can't be read | GeckoTerminal's lists of Pons's pools | No |
| Tokens on the board: live price, liquidity, volume, buys and sells | DexScreener, for the whole board in one request | No |
| Tokens on the board: candles | The pool's own record of its swaps on Robinhood Chain, read from the chain's public endpoint. GeckoTerminal for stretches longer than a day, and when the chain can't be read | No |
| Stock Tokens: live price, the list of tokens | Robinhood's Stock Token API | No |
| Stock Tokens: candles | Yahoo Finance's public chart data | No |
| ETH: price and candles | Binance public data | No |
| ETH, when Binance cannot be reached | CoinGecko | No |
| Other requested tokens: price, liquidity, volume | DexScreener | No |
| Other requested tokens: candles | GeckoTerminal | No |
| Agents' words and decisions | Vercel AI Gateway | Yes |
| Balances and transfers | Robinhood Chain RPC | No |

Three things to know about this data:

- **Robinhood publishes live prices but no price history.** A Stock Token's candles are therefore the underlying share's, scaled by the token's multiplier. The multiplier is how many shares one token stands for; it rises as dividends are reinvested.
- **Yahoo Finance's chart data is public but unofficial.** It can change without notice. It has no candles for the overnight session, so overnight the live price is added as the newest candle.
- **GeckoTerminal allows few requests per minute.** Candle answers are shared between viewers and reused for a short time.

On some networks the system's lookup of a host name fails now and then. The server then asks a DNS server directly (`src/server/dns-fallback.ts`).

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
| `/admin` | The admin's display, behind a sign-in at `/admin/login` |

| Route | Purpose |
| --- | --- |
| `GET /api/admin/status` | The state of what the desk runs on. For the signed-in admin only |
| `GET /api/council/state` | The desk as it stands now |
| `POST /api/council/round` | The session to watch, streamed stage by stage, or how long to wait |
| `GET /api/council/round?round=N` | The record of a finished session |
| `GET /api/council/history` | Past sessions, newest first, a few at a time |
| `GET /api/fund/status` | Funding terms, agents' figures, and one wallet's holdings |
| `POST /api/fund/deposit` | Two steps: prepare, then confirm |
| `POST /api/fund/withdraw` | Two steps: challenge, then submit |
| `POST /api/fund/faucet` | Free test tokens, testnets only |
| `GET /api/market/quotes` | Live quotes for the tokens on the board and the tokens the desk holds |
| `GET /api/market/asset` | Look up a Stock Token by symbol, or any token by address |
| `GET /api/market/candles` | Candles for a token on the board, a token the desk holds, or a requested token |
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
    admin/             the admin's display and its sign-in
    wallet/            wallet picker and connection
    home/, site/       header, footer, ticker, summary cards
  lib/                 shared by server and browser
    council.ts           the desk's accounting
    council-types.ts     the stages the server sends the browser
    director.ts          how a session is staged in the browser
    funding.ts           the arithmetic of bonuses and fees
    market.ts            price feeds, and the tokens the desk used to list
    assets.ts            requested tokens
  server/
    council/           session engine, agents' brains, risk, memory, state
    admin/             the admin's account, sign-in and status
    fund/              deposits, withdrawals, bonuses, faucet
    requests/          the trade request queue
    rewards/           reward claims and payouts
    chains/            everything that touches Robinhood Chain, the desk contracts included
    market/            the trending board, quotes, and data for requested tokens
    db.ts              database connection and tables
    dns-fallback.ts    name lookups that don't give up too early
  store/               the browser's state (floor and prices)
contracts/
  AgentDesk.sol        one agent's desk: holds its USDG, records its trades
  CouncilShares.sol    issues the receipts for the agents' positions
  CouncilDesk.sol      the desk the agents used to share, now closed
  TestUSDG.sol         the test USDG used on the testnet
  test/                the contracts' tests, run with Foundry
scripts/
  setup-testnet.mjs    deploys the test USDG
  deploy-desks.mjs     deploys a desk contract for each agent
  retire-desk.mjs      closes the contract the agents used to share
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
| `TREASURY_PRIVATE_KEY` | Payments: deposits, withdrawals, bonuses, rewards |
| `ROBINHOOD_NETWORK` | `testnet` (the default) or `mainnet` |
| `CLAIM_SECRET` | Signed messages that survive a restart |

For funding on the testnet, send the treasury some testnet ETH from a faucet, then run:

```bash
node --env-file=.env.local scripts/setup-testnet.mjs
```

It deploys a test USDG the treasury can mint and saves its address as `USDG_ADDRESS`. On mainnet the app uses the real USDG and needs no setup script.

To put the desk on-chain, deploy the agents' contracts:

```bash
node --env-file=.env.local scripts/deploy-desks.mjs
```

**Cost.** A session is about 12 model calls and costs roughly $0.10. At the default 5-minute interval that is about $1 to $2 per hour while a page is open. `COUNCIL_MAX_ROUNDS_PER_DAY` (100 by default) caps the daily spend; after that the agents fall back to scripted rules until the next day.

Secrets belong in `.env.local` only. That file is not committed.

## 18. Known limits

- **No order goes to a market.** Trades are settled against the treasury at live prices. Swapping on a market, for example through Uniswap on Robinhood Chain, is not built.
- **The desk contracts are not audited**, and they trust the operator's prices. A version for real money would read prices from the chain's Chainlink feeds.
- **Funding is for the testnet.** It refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true`. Holding users' funds and paying bonuses has legal, licensing and tax consequences in most countries.
- **Market data comes from free public services.** If one is unreachable, a token drops off the board for that session, a request waits, or a chart does not load.
- **Market holidays are not accounted for.** On a holiday the desk treats Stock Tokens as open, and sees prices that do not move.
- **The per-IP limit on rewards trusts the `x-forwarded-for` header**, so the server must sit behind a proxy you control.
- **There are no automated tests in the repository.** The checks used during development live outside version control.
- Nothing on the site is financial advice.
