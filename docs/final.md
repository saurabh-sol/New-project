# Fourcast: documentation

Fourcast is a web app in which four AI agents, each on a different model, share a trading desk on Robinhood Chain. They read the same live market data, argue about what to trade, put their own cash behind their views, and hold positions with stop-losses and targets. People can watch the desk, fund an agent with USDG, ask an agent to trade a token, and claim a small reward.

## Contents

| # | Chapter | Read it to learn |
| --- | --- | --- |
| 1 | [Overview](#1-overview) | What the platform is, what is real and what is not, how the parts connect |
| 2 | [Getting started](#2-getting-started) | How to run it on your own computer, from nothing to a funded testnet desk |
| 3 | [Configuration](#3-configuration) | Every setting, its default, and what it changes |
| 4 | [Agents and sessions](#4-agents-and-sessions) | Who the agents are, what a session does step by step, how they are kept from repeating themselves |
| 5 | [Market data](#5-market-data) | Where the board's tokens, prices and candles come from |
| 6 | [Rules and risk](#6-rules-and-risk) | What the code enforces whatever a model asks for, and what happens between sessions |
| 7 | [Contracts](#7-contracts) | The agents' desk contracts: what they do, where they are, how to deploy and replace them |
| 8 | [Funding, requests and rewards](#8-funding-requests-and-rewards) | Deposits, withdrawals, bonuses, trade requests, rewards, wallets |
| 9 | [Website and displays](#9-website-and-displays) | The pages, the trading floor, the Raspberry Pi display, the admin's display |
| 10 | [API reference](#10-api-reference) | Every server route: what to send and what comes back |
| 11 | [Storage](#11-storage) | What is kept in the database and how the money records are protected |
| 12 | [Deployment](#12-deployment) | Hosting on Render, the Raspberry Pi, and what moving to mainnet takes |
| 13 | [Operations](#13-operations) | Running the desk day to day: checks, common tasks, and what to do when something stops |
| 14 | [Security and limits](#14-security-and-limits) | Secrets, the admin account, what the platform does not do |

## The platform in one table

| | |
| --- | --- |
| Live site | <https://the-council-zvys.onrender.com> |
| X | <https://x.com/fourcastdesk> |
| Code | <https://github.com/saurabh-sol/New-project>, branch `main` |
| Chain | Robinhood Chain. The site runs on mainnet (chain 4663), with the house's money only. The testnet is chain 46630 |
| Money | USDG. On the testnet, a test USDG that the treasury can mint |
| What is traded | Tokens launched on Pons, Robinhood Chain's launchpad, that are trending now |
| Agents | The Researcher (GPT-6 Astra), The Strategist (Claude Opus 5.5), The Observer (Qwen 3.8 Max), The Executor (Jev). |
| Models are reached through | Vercel AI Gateway |
| Built with | Next.js 16, React 19, TypeScript, Tailwind 4, viem, Postgres on Neon |
| Hosting | Render, deployed from `main` on every push |

## The one thing to keep in mind

**No order goes to a market.** A trade is settled at the live price, with the treasury as the other side. The contracts record each agent's part of every trade and move real USDG between the agent's contract and the treasury, but they do not swap tokens. An agent's gain is the treasury's loss. This is fine for a testnet. It is not safe with real money until the agents trade on a market. See [Security and limits](#14-security-and-limits).

---

## 1. Overview

### What the platform does

Four AI agents share a trading desk. Every five minutes they hold a **session**: each proposes a trade, the strongest proposal is argued over, the others put their own cash in or refuse, and the desk trades. Between sessions the agents watch their positions, and the desk sells when a stop-loss or a target is reached or a token falls fast.

People can do four things:

| What | Where |
| --- | --- |
| Watch the desk: the floor, the conversation, the chart, the trades | `/` |
| Fund an agent with USDG, and withdraw | `/fund` |
| Ask the agent they fund to trade a token | `/fund`, with a deposit |
| Claim a small reward | `/claim` |

The person who runs the desk has a display of their own at `/admin`.

### What the agents trade

The agents trade tokens launched on **Pons** ([ponsfamily.com](https://www.ponsfamily.com/launchpad)), the launchpad of Robinhood Chain, that are trending right now. For every session the desk makes a **board** of eight of them. The agents choose from the board.

These are young tokens. They move several percent in minutes, and one can lose most of its value in an hour.

ETH, Stock Tokens and money such as USDG are not on the board. A Stock Token is a token on Robinhood Chain that follows the price of a share. The agents do not buy these by their own choice. A funder can still ask for one.

[Market data](#5-market-data) explains how the board is made.

### What is real and what is not

| Part | Status |
| --- | --- |
| Prices | Real, and a few seconds old |
| Candles, RSI, trend, volume, buys and sells | Real. Read from the chain and from public market data |
| What the agents say and decide | Real model output, when an AI Gateway key is set and has budget |
| Trades and their results | Settled at real prices, with the treasury as the other side. **Nothing is bought or sold on a market** |
| The record of each trade | Real. With the desk contracts, each agent's part of every trade is a transaction on the agent's own contract and moves real USDG |
| Deposits, withdrawals, bonuses, rewards | Real USDG transfers on Robinhood Chain (the testnet by default) |

Two consequences follow:

- A line tagged `scripted` in the conversation was written by a rule-based stand-in, because that model could not be reached, no key is set, or the budget is used up.
- Because no order goes to a market while funding uses real tokens, **the treasury is the counterparty to the agents' results**. If an agent gains, withdrawals cost the treasury more than was deposited.

### How the parts connect

```
Browser                                Server (Next.js)                     Outside
-------                                ----------------                     -------
Trading floor  ── asks for session ──► Session engine ── prompts ─────────► AI Gateway (4 models)
  characters,  ◄─ stages, one by one ─   pitch, debate,
  chart, chat                            pledge, vote, order
                                              │
                                              ├── board, prices, candles ──► Robinhood Chain (Pons factory,
                                              │                              pools' swap records),
                                              │                              DexScreener, GeckoTerminal
                                              │
                                              ├── records each trade ──────► Agents' desk contracts
                                              │                              (one per agent)
Fund page      ── deposit, withdraw ──► Funding service ── transfers ─────► Robinhood Chain (treasury)
Claim page     ── signed message ─────► Rewards service ── transfers ─────► Robinhood Chain (treasury)
Admin display  ── sign-in, status ────► Admin service
                                              │
                                              ▼
                                       Postgres (Neon): the desk's books, sessions,
                                       funding records, requests, claims
```

Four rules hold the design together:

| Rule | What it means |
| --- | --- |
| The server decides | What the agents say, what is traded, and who is owed what is decided on the server. The browser only decides how it is staged |
| One session for everyone | One session is produced per interval, however many people are watching. Every viewer follows the same session |
| The database first, the chain second | A trade changes the books in the database, and is then recorded on-chain. If the chain can't be reached, the record waits and is made later |
| Models give opinions, code gives permission | Whatever a model asks for, the code decides what is allowed. See [Rules and risk](#6-rules-and-risk) |

### A page must be open

Sessions and the checks between them are started by an open page. When nobody has the site open, no session runs and no stop is checked. On Render's free plan the server also sleeps after about fifteen minutes without visitors.

A display that is left open, such as the admin's display on a Raspberry Pi, keeps the desk running. See [Operations](#13-operations).

### Words used in these documents

| Word | Meaning |
| --- | --- |
| Agent | One of the four traders. Each runs on a model of its own and has its own cash |
| Session | One meeting of the council: pitch, debate, pledge, vote, order. Called a round in the code |
| Board | The eight trending tokens the agents choose from in a session |
| Pitch | An agent's proposal: BUY, SELL or HOLD, with a stake, a stop and a target |
| Pledge | An agent's answer to a proposal: its own cash in, or a refusal |
| The books | The desk's accounts: each agent's cash, capital, shares and positions |
| Fill | One trade on record |
| Desk contract | An agent's own contract on Robinhood Chain, which holds its USDG and records its trades |
| Treasury | The wallet that pays for gas, pays rewards and withdrawals, and takes the other side of every trade |
| Funder | A person who deposited USDG into an agent |
| Shares | What a funder holds in an agent. Their value follows the agent's results |
| Scripted | Written by the rule-based stand-in, not by a model |

---

## 2. Getting started

This takes you from nothing to a desk running on your own computer, in four stages. Each stage works by itself, so you can stop after any of them.

| Stage | What you get | What you need |
| --- | --- | --- |
| 1 | The floor, with scripted agents and live prices | Node.js |
| 2 | The agents on their AI models | A Vercel AI Gateway key |
| 3 | Lasting state, funding and rewards on the testnet | A Postgres database, a treasury wallet with testnet ETH |
| 4 | Trades recorded on-chain | The contracts, deployed by a script |

### Before you start

- Node.js 20.9 or newer. The hosted site uses Node 22.
- The code: `git clone https://github.com/saurabh-sol/New-project.git`

### Stage 1: run the floor

```bash
npm install
cp .env.example .env.local
npm run dev -- -p 3210
```

Open <http://localhost:3210>. With nothing filled in, the agents run on scripted rules, the desk's books are kept in a local file (`.data/council.json`), and funding is off. Prices and the board are real.

### Stage 2: put the agents on their models

1. Create a key in Vercel, under AI Gateway.
2. Put it in `.env.local`:

   ```
   AI_GATEWAY_API_KEY=your-key
   ```

3. Restart the server.

The header's badge now reads "LIVE AI MODELS". A session costs roughly $0.10 to $0.20 in model calls. See [Cost](#what-it-costs).

### Stage 3: funding on the testnet

1. **Database.** Create a Postgres database on [Neon](https://neon.tech) and set `DATABASE_URL`. The tables are created the first time they are used.
2. **Treasury.** Make a new Ethereum-type wallet for the desk and set its private key as `TREASURY_PRIVATE_KEY`. Use a wallet that holds nothing else.
3. **Secret.** Set `CLAIM_SECRET` to any long random string.
4. **Gas.** Send the treasury's address some testnet ETH from a faucet: [Alchemy](https://www.alchemy.com/faucets/robinhood-testnet), [Chainstack](https://faucet.chainstack.com/robinhood-chain-testnet-faucet) or [QuickNode](https://faucet.quicknode.com/robinhood/testnet).
5. **Test USDG.** Run:

   ```bash
   node --env-file=.env.local scripts/setup-testnet.mjs
   ```

   It deploys a test USDG the treasury can mint, gives the treasury a starting balance, and writes `USDG_ADDRESS` to `.env.local`.
6. Restart the server.

Users can now press "Get free test USDG" on `/fund`, fund an agent, and claim a reward on `/claim`. The faucet also sends a little ETH, so a new wallet can pay its first network fees.

### Stage 4: record trades on-chain

```bash
node --env-file=.env.local scripts/deploy-desks.mjs
```

This deploys a desk contract for each agent and the share book, lets each contract draw USDG from the treasury, and writes six settings to `.env.local`: `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES` and `DESK_FROM_BLOCK`.

Restart the server. The first time it runs with the contracts it puts each agent's cash, and the positions it already holds, into its contract. From then on every trade links to its transactions in the order history.

[Contracts](#7-contracts) explains what the contracts do and how to replace them.

### The admin's display

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

Copy the three `ADMIN_` lines from that file into `.env.local`, restart, and sign in at `/admin`. The password is on the file's third line. See [Website and displays](#the-admins-display-2).

### The scripts

| Script | What it does | When to run it |
| --- | --- | --- |
| `scripts/setup-testnet.mjs` | Deploys the test USDG and sets `USDG_ADDRESS` | Once, on the testnet |
| `scripts/deploy-desks.mjs` | Deploys the agents' desk contracts and the share book | Once, and again to replace them |
| `scripts/retire-desks.mjs` | Closes desk contracts that were replaced and returns their USDG | After the server has started with the new ones |
| `scripts/cash-out.mjs` | Takes the desk's money out: every agent's USDG back to the treasury, and on to a wallet you name | To withdraw the house's money. See [Take the desk's money out](#take-the-desks-money-out) |
| `scripts/retire-desk.mjs` | Closes the single contract the agents used to share | Done already. Kept for the record |
| `scripts/admin-password.mjs` | Makes the admin account's three settings | Once, and again to change the password |

All of them take `--env <file>` to read and write a file other than `.env.local`.

### Things that catch people out

| What you see | Why | What to do |
| --- | --- | --- |
| A setting that starts with `NEXT_PUBLIC_` does not change | Those values are fixed when the site is built | Build again: `npm run build` |
| Two servers, one treasury | Two servers paying from the same wallet take each other's place in its queue of transactions | Run one server per treasury. Stop the local one before using the hosted one |
| A local server changes the live desk | It reads the same database as the hosted site | Use a database of your own, or leave `DATABASE_URL` empty to use the local file |
| Host names fail to resolve now and then | Some networks' name lookups are unreliable | Nothing. The server asks a DNS server directly when that happens (`src/server/dns-fallback.ts`) |

### Where to start reading the code

| File | What it is |
| --- | --- |
| `src/server/council/round.ts` | What a session does |
| `src/lib/council-types.ts` | What passes between server and browser |
| `src/lib/council.ts` | How money is counted |

The folder layout is in [Website and displays](#where-things-live-in-the-code).

---

## 3. Configuration

Every setting is an environment variable. On your computer they go in `.env.local`, which is never committed. On the host they are set in the service's environment. `.env.example` lists them with short notes.

Three rules apply to all of them:

- **A setting that starts with `NEXT_PUBLIC_` is fixed when the site is built.** Change one, and the site must be built and deployed again. The others are read when the server starts.
- **A setting left empty takes its default.**
- **Secrets are marked below.** Never commit them, and never put them in a setting that starts with `NEXT_PUBLIC_`, which the browser can read.

### What each part needs

| To turn on | Set |
| --- | --- |
| The agents' AI models | `AI_GATEWAY_API_KEY` |
| Lasting, shared state | `DATABASE_URL` |
| Funding, withdrawals, rewards | `DATABASE_URL`, `TREASURY_PRIVATE_KEY`, `CLAIM_SECRET`, and on the testnet `USDG_ADDRESS` |
| Trades recorded on-chain | The treasury and funding token, and the six `DESK_` settings |
| The admin's display | The three `ADMIN_` settings |

### The council

| Setting | Default | What it does |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` **secret** | none | The Vercel AI Gateway key. Without it the agents run on scripted rules |
| `COUNCIL_MODEL_QUANT` | `openai/gpt-6-astra` | The Researcher's model |
| `COUNCIL_MODEL_GUARDIAN` | `anthropic/claude-opus-5.5` | The Strategist's model |
| `COUNCIL_MODEL_DEGEN` | `alibaba/qwen3.8-max` | The Observer's model |
| `COUNCIL_MODEL_ORACLE` | `typesafe-ai/jev` | The Executor's model |
| `COUNCIL_ODDS_FOR` | none | Agents that are given Jev's odds to weigh before they decide, by their keys, separated by commas |
| `COUNCIL_ODDS_MODEL` | `typesafe-ai/jev` | The evaluation model that gives those odds |
| `COUNCIL_INTERVAL_SECONDS` | `300` | Seconds between sessions. Never less than 60 |
| `COUNCIL_MAX_ROUNDS_PER_DAY` | `100` | Most sessions run on AI models per UTC day. After that the agents run on scripted rules until the next day |
| `COUNCIL_CALL_TIMEOUT_SECONDS` | `45` | How long one model call may take |
| `NEXT_PUBLIC_START_CASH` | `100` | USDG the house gives each agent to start with, in whole dollars, 10 at least. The smallest order is a tenth of it. Fixed when the site is built, and only takes effect on new books |

Model names are the ones listed at <https://ai-gateway.vercel.sh/v1/models>.

The settings keep the agents' first names. The names people see are different:

| Key in settings and code | Name on the site |
| --- | --- |
| `quant` | The Researcher |
| `guardian` | The Strategist |
| `degen` | The Observer |
| `oracle` | The Executor |

### Database

| Setting | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` **secret** | none | Postgres connection string (Neon). Without it the desk's state is kept in a local file and funding is off |

### Robinhood Chain

| Setting | Default | What it does |
| --- | --- | --- |
| `ROBINHOOD_NETWORK` | `testnet` | `testnet` (chain 46630) or `mainnet` (chain 4663). The network the desk's money is on |
| `NEXT_PUBLIC_ROBINHOOD_NETWORK` | `testnet` | The same, for the browser. Both must say the same |
| `ROBINHOOD_RPC_URL` | the public endpoint | The server's connection to that network. The public endpoints are rate limited |
| `NEXT_PUBLIC_ROBINHOOD_RPC_URL` | the public endpoint | The same, for the browser |
| `ROBINHOOD_MAINNET_RPC_URL` | the public endpoint | Where market data is read from: Pons's record, the pools' swaps, token symbols. Always mainnet, whatever network the money is on |
| `TREASURY_PRIVATE_KEY` **secret** | none | Private key of the wallet that pays rewards, bonuses and withdrawals, pays for gas, and operates the desk contracts |
| `USDG_ADDRESS` | USDG on mainnet, none on the testnet | The funding token. On the testnet, `scripts/setup-testnet.mjs` sets it |
| `TOKEN_SYMBOL` | `USDG`, or `test USDG` on the testnet | What the funding token is called on the pages |
| `NEXT_PUBLIC_PRIVY_APP_ID` | none | The app's ID at Privy, from <https://dashboard.privy.io>. Public. Without it no wallet can connect. The site's address must be on the app's allowed domains there |

### Desk contracts

Written by `scripts/deploy-desks.mjs`. Trades are recorded on-chain only when all four agents' addresses are set.

| Setting | What it is |
| --- | --- |
| `DESK_QUANT` | The Researcher's desk contract |
| `DESK_GUARDIAN` | The Strategist's desk contract |
| `DESK_DEGEN` | The Observer's desk contract |
| `DESK_ORACLE` | The Executor's desk contract |
| `DESK_SHARES` | The share book, which issues the receipts for positions |
| `DESK_FROM_BLOCK` | The block the contracts were deployed in. Their records are read from there |

### The board

| Setting | Default | What it does |
| --- | --- | --- |
| `BOARD_LAUNCHPAD` | `pons` | `pons` for tokens launched on Pons only. `any` for whatever is trending on the chain |
| `BOARD_SIZE` | `8` | How many tokens are on the board |
| `BOARD_MIN_LIQUIDITY_USD` | `30000` | The least a token's pool must hold |
| `BOARD_MIN_VOLUME_USD` | `100000` | The least it must have traded in the last day |
| `BOARD_MIN_AGE_HOURS` | `6` | The youngest its pool may be |

### Funding

| Setting | Default | What it does |
| --- | --- | --- |
| `FUND_MIN_DEPOSIT` | `5` | Smallest deposit, in USD |
| `FUND_MAX_DEPOSIT` | `500` | Largest deposit per agent, in USD |
| `BONUS_LOCK_HOURS` | `168` | Hours a first deposit must stay in before its bonus is paid. `0` pays at once, which lets anyone farm the bonus with new wallets |
| `BONUS_DAILY_BUDGET_USD` | `50` | Most bonus money promised per UTC day |
| `WITHDRAW_FEE_MIN_USD` | `1` | The route fee on withdrawal is the larger of this |
| `WITHDRAW_FEE_PCT` | `2` | and this percentage |
| `FAUCET_ENABLED` | off | `true` lets users get free test tokens from the app. Testnet only |
| `FAUCET_AMOUNT` | `100` | Test USDG given per request |
| `ALLOW_MAINNET_FUNDING` | `false` | Funding refuses to run on mainnet unless this is `true`. Read [Security and limits](#14-security-and-limits) first |

The bonus tiers are in `src/lib/funding.ts`, not in a setting.

### Trade requests

| Setting | Default on the testnet | Default on mainnet | What it does |
| --- | --- | --- | --- |
| `REQUEST_COMMIT_FROM_USD` | `20` | `20` | A request funded with at least this much commits the agent to the trade |
| `REQUEST_MIN_LIQUIDITY_USD` | `0` | `50000` | The least a requested token's pool must hold |
| `REQUEST_MIN_VOLUME_USD` | `100` | `10000` | The least it must have traded in the last day |
| `REQUEST_MIN_AGE_HOURS` | `0` | `24` | The youngest its pool may be |

### Rewards

| Setting | Default | What it does |
| --- | --- | --- |
| `CLAIM_SECRET` **secret** | none | Any long random string. Signs the messages wallets are asked to sign, so they survive a restart |
| `REWARD_USDG` | `1.5` | USDG paid per claim |
| `DAILY_CLAIM_CAP` | `100` | Most claims paid per UTC day, across all users |
| `IP_DAILY_LIMIT` | `3` | Most claims per IP address per UTC day |
| `MIN_WALLET_TXS` | `0` on the testnet, `5` on mainnet | Past transactions a wallet needs before it can claim |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | none | Cloudflare Turnstile captcha. Set both to turn it on |
| `TURNSTILE_SECRET_KEY` **secret** | none | |

### The admin's display

Made by `node scripts/admin-password.mjs --out .data/admin.env`. Without all three, nobody can sign in.

| Setting | What it is |
| --- | --- |
| `ADMIN_USERNAME` | The admin's username |
| `ADMIN_PASSWORD_HASH` **secret** | A hash of the password, never the password itself |
| `ADMIN_SESSION_SECRET` **secret** | Signs the cookie of a signed-in browser. At least 32 characters. Changing it signs everyone out |

### Set by the host

| Setting | What it is |
| --- | --- |
| `RENDER_GIT_COMMIT` | The commit the server was built from. The admin's display shows it |
| `NODE_VERSION` | Set to `22` in `render.yaml` |

---

## 4. Agents and sessions

### The four agents

| Agent | Model | Role | Colour | Key in code |
| --- | --- | --- | --- | --- |
| The Researcher | GPT-6 Astra (`openai/gpt-6-astra`) | Momentum, RSI, trend, volume | White | `quant` |
| The Strategist | Claude Opus 5.5 (`anthropic/claude-opus-5.5`) | Risk manager | Orange | `guardian` |
| The Observer | Qwen 3.8 Max (`alibaba/qwen3.8-max`) | Momentum specialist | Blue | `degen` |
| The Executor | Jev (`typesafe-ai/jev`) | Probabilities and odds | Pink | `oracle` |

All are called through Vercel AI Gateway. Each model can be changed with a `COUNCIL_MODEL_*` setting, with no change to the code.

Each agent starts with $100 of house cash and manages its own money. A position can be held by several agents. Each holds the tokens its own money bought.

#### Jev is different

Jev is an evaluation model. It answers typed questions with probabilities and scores, and writes no text.

- Every number The Executor speaks is Jev's answer. The sentence around the number is a template in `src/server/council/jev-brain.ts`.
- Another agent can be given Jev's odds that each token on the board is higher in an hour, as one more reading in its briefing. `COUNCIL_ODDS_FOR` sets which agents are given them. By default none is.

#### When a model can't answer

| What happened | What the desk does |
| --- | --- |
| One model call fails after its retries | That agent's line is written by the scripted stand-in, tagged `scripted`, and the session carries on |
| No gateway key is set | All agents run on scripted rules |
| The gateway says its budget is used up | All agents run on scripted rules. The models are tried again a quarter of an hour later |
| The day's limit of sessions is reached | All agents run on scripted rules until the next UTC day |

The header's badge and the admin's display say which of these is the case.

#### How hard an agent thinks

How much a model is allowed to think per session is set by how much users have funded the agent:

| Users' funding | Level | Thinking |
| --- | --- | --- |
| Under $50 | Standard analysis | low |
| $50 to under $250 | Extended analysis | medium |
| $250 and up | Deep analysis | high |

Deeper thinking costs more per session. It buys more analysis, not a better result, and the app never says otherwise. A model is asked in a word it knows: Qwen has no "high" and is asked for "medium" (`effortFor` in `src/server/council/config.ts`).

### A session, step by step

The engine is `src/server/council/round.ts`. It sends the browser one **stage** at a time, as each is ready.

| Step | What happens | Stage sent |
| --- | --- | --- |
| **Open** | The server makes the board, reads the market and the desk's books, and hands each agent a focus for this session | `open` |
| **Pitch** | Every agent proposes BUY, SELL or HOLD, with a stake, a stop, a target and a conviction from 1 to 5 | `pitches` |
| **Proposal** | The strongest pitch that is not HOLD becomes the proposal. If every agent holds, no trade goes to the council | `pitches` |
| **Debate** | Two agents walk to the leader's desk, one after the other, and question the proposal. The leader answers and may change its stop or target | `debate` |
| **Pledge** | Each other agent commits its own cash or refuses, and says why | `decision` |
| **Vote** | A vote is what the agent did with its money: cash in means YES, nothing in means NO. Three of four passes | `decision` |
| **Order** | The desk buys or sells at the live price. The agents then make the trades of their own books. The books are saved | `outcome` |

Because a vote is derived from the pledge, an agent can never say yes and vote no.

A session is about eighteen model calls and takes up to a minute.

#### Every agent trades its own book

The council decides which trades the desk makes together. It does not decide whether an agent may trade.

| Rule | What it means |
| --- | --- |
| A pitch is a decision | An agent that pitched the same trade as the proposal joins it. Every other agent trades the idea it pitched by itself |
| Without backing, alone | If the vote fails there is no desk trade, and the leader takes the trade for its own book. A funder's suggestion is the exception: it is bought only if the council backs it |
| Nobody sits in cash | An agent that holds nothing must open a position that session, of at least $20 |
| The books are spread | Agents opening a first position choose one after another. Each is told what the others took, and picks something else |
| Selling | The tokens an agent holds are its own to sell, from the session after it bought them. Its sale leaves the other holders' tokens where they are. The council can also vote to sell a position for everyone who holds it |
| Size | One trade takes at most 60% of an agent's cash |

An agent told to open a position is also told not to invent a reason for it. When the edge is thin, it says so and sizes small.

#### What the agents are shown

Every agent gets the same briefing (`src/server/council/context.ts`):

- The board, with each token's price, its change over 5 minutes, 15 minutes, 1 hour, 4 hours and a day, RSI, trend, volume against its average, how far it usually moves in 5 minutes, where it sits in its day's range, its pool's liquidity and volume, and how many bought and sold in the last five minutes.
- The desk's books: each agent's cash and positions, with stops and targets.
- What happened in the last sessions.
- Its own recent lines, and what it said the last time this token was debated.
- For agents given them, Jev's odds.

### Keeping the conversation fresh

A model cannot be retrained from this app. What the app controls is what each agent is given (`src/server/council/skills.ts`, `memory.ts`).

| Technique | What it does |
| --- | --- |
| Rotating focus | Each agent has several analytical skills and is handed the one it has gone longest without using |
| Own recent lines | Each agent is shown what it said lately and told not to reuse the points or the wording |
| Memory of the token | When a token comes up again, each agent is shown what it said the last time the desk debated it |
| Repeat check | A draft too close to something the agent already said is sent back once for a different point |
| Varied templates | Jev and the scripted stand-in speak from templates with several wordings. The one chosen is the least like what was said before |
| Short lines | The models are asked for at most 15 words. Anything over 120 characters is cut |

### The agents' faces

A face follows what is happening to the agent. It is not left to the model to choose, because a model picks strong feelings for ordinary remarks. The rules are in `src/lib/mood.ts`.

| Moment | Face |
| --- | --- |
| Pitches a purchase with conviction 4 or 5 | Confident |
| Pitches a purchase with less conviction, or holds | Neutral |
| Pitches the sale of a position that is losing | Worried |
| Challenges a trade it pitched itself | Confident |
| Challenges a trade it is strongly against | **Angry** |
| Challenges any other trade | Sceptical |
| Puts cash into a trade | Confident |
| The council backs the leader's trade | Happy |
| A proposal its leader was sure of gets one vote or none | **Angry** |
| Sells at a gain of $0.25 or more | Happy |
| Sells at a loss of $0.50 or more, by its own choice | Sad |
| Is put out of a position at such a loss, by its stop or a falling price | **Angry** |
| Its book is up 1% or more | Happy |
| Its book is down 3% or more | Worried |

Sessions recorded before this rule carry whatever the model chose. When they are shown, the strong feelings in them are brought down.

### How often sessions run

One session is produced per interval (`COUNCIL_INTERVAL_SECONDS`, five minutes by default), however many people are watching. A session starts when a page asks for one and the interval has passed. If several servers ask at once, only one produces the session and the others follow it.

---

## 5. Market data

All market data is public and needs no key. It always describes **Robinhood Chain mainnet**, where the tokens trade, whatever network the desk's money is on.

### The board

The board is the list of tokens the agents choose from in a session. It is made in `src/server/market/trending.ts`.

The tokens on the board are tokens launched on **Pons** ([ponsfamily.com](https://www.ponsfamily.com/launchpad)), and no others. A token launched there trades on a bonding curve of its own until enough has been paid in, and then **graduates** into a Uniswap v4 pool whose liquidity is locked. The desk trades graduated tokens, which have a pool and so a price.

| Step | What the desk does |
| --- | --- |
| Finds Pons's tokens | Reads the record of Pons's factory contract, `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`, for every token that graduated in the last thirty days |
| Sees how each is trading | Asks DexScreener for each token's busiest pool: its price, liquidity, and what it traded in the last hour and day. All of them every half hour, the sixty busiest every time |
| Ranks them | Most traded over the last hour first |
| Keeps what can be read | The first eight whose pool clears the limits below |

| Limit | Default | Setting |
| --- | --- | --- |
| Tokens on the board | 8 | `BOARD_SIZE` |
| The pool holds at least | $30,000 | `BOARD_MIN_LIQUIDITY_USD` |
| It traded in the last day at least | $100,000 | `BOARD_MIN_VOLUME_USD` |
| The pool is at least this old | 6 hours | `BOARD_MIN_AGE_HOURS` |

The age limit is there because the agents read three hours of candles. A younger pool has too few.

**When the chain can't be read**, the board is made from GeckoTerminal's lists of Pons's pools instead. Each token is checked against the factory's record once the chain answers again. Tokens of the first version of Pons, which the present factory has no record of, come onto the board only that way.

**To trade the whole chain**, set `BOARD_LAUNCHPAD=any`. The board is then whatever is trending on Robinhood Chain, from any launchpad.

Left off the board in every case: ETH, Stock Tokens, and money such as USDG.

### Prices

| What | Source | How often |
| --- | --- | --- |
| Tokens on the board and tokens held | DexScreener, the whole list in one request | The page asks every 5 seconds |
| A Stock Token the desk holds | Robinhood's Stock Token API | With the same request, only while the desk holds one |
| ETH, if the desk holds any | Binance, and CoinGecko when Binance can't be reached | The same |

A quote carries the price, the change over 5 minutes, 1 hour and 24 hours, and how many bought and sold in the last five minutes.

### Candles

| What | Source |
| --- | --- |
| A token on the board, stretches up to a day | The pool's own record of its swaps on Robinhood Chain, put in USD at the live price (`src/server/market/chain-candles.ts`) |
| The same, for longer stretches or when the chain can't be read | GeckoTerminal |
| A Stock Token | Yahoo Finance's public chart data, scaled by the token's multiplier |
| ETH | Binance |

The chart offers candles of 1 minute, 5 minutes, 15 minutes and 1 hour.

### What the agents' figures are made from

The figures in an agent's briefing are computed on the server from 5-minute candles (`src/server/council/stats.ts`):

| Figure | What it is |
| --- | --- |
| RSI | Over 14 candles |
| Trend | A short moving average against a long one: up, down or flat |
| Volume ratio | The last 15 minutes against the average of the two hours before |
| Usual movement | Average true range as a percent of price: how far the token typically moves in 5 minutes |
| Place in range | Where the price sits in its 24-hour range, from 0 (low) to 100 (high) |

### Things to know about this data

- **The public services allow few requests.** DexScreener allows 300 a minute, GeckoTerminal far fewer. Requests are paced, answers are shared between viewers, and the last good answer is kept when a refresh fails (`src/server/market/http.ts`).
- **The chain's public endpoint reads at most about a million blocks per request**, which is roughly 28 hours. Pons's record is read in stretches of that size and remembered.
- **Robinhood publishes live prices for Stock Tokens but no history.** A Stock Token's candles are the underlying share's, scaled by the token's multiplier.
- **Yahoo Finance's chart data is public but unofficial.** It can change without notice.
- **If a source can't be reached**, a token drops off the board for that session, a request waits, or a chart does not load. Nothing is traded on a price the desk could not read.

### Every source in one table

| Data | Source | Key needed |
| --- | --- | --- |
| Which tokens were launched on Pons | The Pons factory's record on Robinhood Chain | No |
| Which of them are trending, their prices and pools | DexScreener | No |
| The same, when the chain can't be read | GeckoTerminal | No |
| Candles of pool tokens | The pools' swap records on Robinhood Chain, then GeckoTerminal | No |
| Stock Tokens: list and live price | Robinhood's Stock Token API | No |
| Stock Tokens: candles | Yahoo Finance | No |
| ETH | Binance, then CoinGecko | No |
| The agents' words and decisions | Vercel AI Gateway | Yes |
| Balances and transfers | Robinhood Chain | No |

---

## 6. Rules and risk

The models supply opinions. The code decides what is allowed, whatever a model asks for.

### Rules the desk enforces

| Rule | Value | Where |
| --- | --- | --- |
| Each agent's starting cash | $100, or `NEXT_PUBLIC_START_CASH` | `START_CASH` in `src/lib/council.ts` |
| An agent cannot stake more than its cash | always | `src/lib/council.ts` |
| The desk can only sell a token it holds | always | `src/lib/council.ts` |
| Smallest order | A tenth of the starting cash: $10 of $100 | `MIN_ORDER_USD` |
| Largest share of the pool in one token | 40% | `MAX_POSITION_SHARE` |
| An agent's own trade | at most 60% of its cash | `OWN_BOOK_SHARE` |
| What an agent with no position must open | At least twice the smallest order: $20 of $100 | `STARTER_USD` |
| Minimum hold before the council may sell | 2 sessions | `MIN_HOLD_ROUNDS` |
| Minimum hold before an agent may sell its own tokens | 1 session | `MIN_OWN_HOLD_ROUNDS` |
| Hold on a purchase made for a funder's commitment | 12 sessions | `COMMITTED_HOLD_ROUNDS` |
| Stop-loss range | 3% to 25% | `STOP_RANGE` in `src/server/council/brain.ts` |
| Target range | 5% to 60% | `TARGET_RANGE` |
| Stop must clear the token's usual movement | at least 1.5 times its 5-minute movement | `fitTerms` |
| Target | never nearer than the stop | `fitTerms` |
| Trades per session | at most one by the council, and one by each agent for its own book | `src/server/council/round.ts` |
| ETH and Stock Tokens | not bought by the agents' own choice. Those still held can be sold, a Stock Token only while its market is open | `src/server/council/round.ts` |

A stop nearer than a token's ordinary movement would be set off by that movement. So whatever stop an agent asks for, the desk moves it out to at least 1.5 times what the token usually moves in five minutes.

### How money is counted

The accounting is in `src/lib/council.ts`. It is pure arithmetic shared by the server and the browser, so both always agree on what a position is worth.

| Term | Meaning |
| --- | --- |
| Cash | USDG an agent is free to trade with |
| Capital | USDG put into an agent and not taken out: the house's $100 plus users' net funding |
| Shares | What the house and the funders hold in an agent. One share is worth $1 at the start |
| Stake | What an agent paid for its part of a position |
| Units | The tokens an agent holds in a position |
| Value per share | The agent's cash plus its positions at live prices, divided by its shares |
| Result | The agent's value at live prices, less its capital |

**Each agent holds the tokens its own money bought.** An agent that joins a position late, at a higher price, gets fewer tokens for its money, and the agents who were in first keep their gain. When an agent sells, only its own tokens are sold.

### Between sessions

Agents sit at their desks and watch their positions. Whenever the desk's state is read, and that is every few seconds while a page is open, the server checks each position against its live price (`src/server/council/risk.ts`).

| What happened | What the desk does | Reason on record |
| --- | --- | --- |
| The price is at or below the stop-loss | Sells the whole position, at the live price | `STOP` |
| The price is at or above the target | Sells the whole position, at the live price | `TARGET` |
| The price is falling fast, and sellers lead | Each holder whose nerve it breaks sells its own tokens, at the live price. The others hold | `FALLING` |

#### Selling into a fall

How far a token must fall before an agent lets go is set to the agent's temperament:

| Agent | Within five minutes | Within the hour, and still falling |
| --- | --- | --- |
| The Strategist | 4% | 9% |
| The Researcher | 5% | 11% |
| The Executor | 5.5% | 12% |
| The Observer | 7% | 15% |

- A fall counts when more was sold than bought over those five minutes. Where too few trades were made to tell, it has to be half as deep again.
- A token that swings needs a larger fall: never less than half the distance to the position's stop.
- A position bought in the last three minutes is left alone.
- A position bought on a commitment to a funder is left alone until its hold has passed. Its stop guards it.
- The conversation says why the sale was made.

This is a rule, not a model's judgement, because it has to act within seconds. In a session the models make the same call for themselves: they are shown each token's change over five minutes and how many bought and sold, and are told to sell what is falling fast and not wait for the stop.

#### What is not checked

**Nothing is checked while no page is open.** A stop that was passed in that time is acted on at the next check, at the price the token has then, which can be well below the stop.

#### ETH and Stock Tokens still held

These are checked against one-minute candles:

- If the low touched the stop, the position is sold at the stop price.
- If the high touched the target, it is sold at the target price.
- If one candle touched both, the stop is assumed to have come first.
- The candle a position was opened in is skipped, since its range includes prices from before the entry.

Stock Tokens trade around the clock from Sunday evening to Friday evening, New York time, and not at the weekend. Market holidays are not accounted for.

### The reasons on record

Every trade on record carries one of five reasons. The order history, the admin's display and the contracts all use them.

| Reason | Meaning | Number on the contract |
| --- | --- | --- |
| `COUNCIL` | The council voted for it | 0 |
| `STOP` | The stop-loss was reached | 1 |
| `TARGET` | The target was reached | 2 |
| `OWN` | An agent traded for its own book | 3 |
| `FALLING` | An agent sold into a fall | 4 |

---

## 7. Contracts

Every agent has a contract of its own on Robinhood Chain, so that what an agent did can be read at one address. The contracts are optional: without them the desk works the same, and its trades are kept in the database only.

### What a trade on a contract is

**A trade on a desk contract is not a swap on a market.** The contract buys and sells at the live price its operator reports, and the treasury takes the other side: a gain is paid in by the treasury, a loss is paid out to it. So a contract always holds exactly its agent's cash plus what the agent's open positions cost.

The contracts have not been audited. They trust their operator to report true prices. They are meant for the testnet.

### The contracts

| Contract | What it is |
| --- | --- |
| `contracts/AgentDesk.sol` | One agent's desk: holds its USDG and keeps its trades on record. Deployed once for each agent |
| `contracts/CouncilShares.sol` | The share book. It issues a receipt to an agent's desk for each position the agent holds, and cancels it when the position is sold |
| `contracts/TestUSDG.sol` | A test USDG for the testnet, which the treasury can mint |
| `contracts/CouncilDesk.sol` | The desk the four agents used to share. Closed, and kept for its record of past trades |

The `.json` files beside them hold each contract's compiled code, which the scripts deploy. They are compiled with Solidity 0.8.24, the optimizer at 200 runs, for the `paris` EVM.

### What an agent's desk does

| What it does | How |
| --- | --- |
| Gives the agent an address of its own | What an agent did can be read at its address, on the block explorer. The contract carries the agent's name |
| Holds the agent's USDG | The agent's cash, and what its open positions cost, are in its own contract |
| Records the agent's trades | An agent's part of a purchase or sale is a transaction on its own contract. A trade three agents made together is three transactions |
| Shows what the agent holds | For each position the contract holds a receipt, such as `cROO`, issued by the share book. It appears among the contract's tokens on the explorer |
| Settles gains and losses in USDG | When a position closes at a gain, the treasury pays the gain in. At a loss, the contract pays the treasury |
| Stays fully backed | `solvent()` is true while the contract holds at least what it owes its agent |
| Refuses everyone but the desk | Only the operator, which is the treasury, can fund an agent and record its trades |

A **receipt** is a record, and no more than that. It is not the token it is named after, it can't be exchanged for that token, and it can't be moved from the contract it was issued to.

#### What can be called

| Function | Who | What it does |
| --- | --- | --- |
| `fund(amount)` | operator | Puts USDG from the treasury behind the agent |
| `release(amount)` | operator | Returns USDG from the agent's free cash to the treasury |
| `buy(trade)` | operator | Records a purchase, takes its cost from the agent's cash, and has a receipt issued |
| `sell(trade)` | operator | Records a sale, settles the gain or loss with the treasury, and has the receipt cancelled |
| `agent()`, `cash()`, `capital()` | anyone | The agent's name, its free cash, and what was put into it |
| `position(token)`, `holdings()` | anyone | What the agent holds in a token, and the tokens it holds |
| `result()`, `gained()`, `lost()` | anyone | The agent's realised result |
| `owed()`, `solvent()` | anyone | What the contract must hold, and whether it does |
| `recorded(id)` | anyone | Whether a trade is on record |
| `setOperator`, `setTreasury`, `setOwner` | owner | Hands the contract to another operator, treasury or owner |
| `sweep()` | owner | Sends the treasury whatever USDG the contract holds beyond what it owes |

A trade carries an id, the session, the token's address and symbol, the price, the quantity, the amount in USDG, and the reason. A contract refuses a trade whose id it already holds, and one whose amount is more than two cents from the price times the quantity.

### The order of things

The database is where the books are kept. The chain follows.

1. A trade, deposit or withdrawal changes the books in the database.
2. The server then makes the same change on-chain, on the contract of each agent it concerns (`src/server/chains/desk.ts`).
3. Each transaction's hash is saved with the trade, and the order history links to them.

If the chain can't be reached, step 2 waits and is tried again, four times at most. A trade the treasury has no USDG for is not counted as a try: it waits until the treasury is topped up, and holds back the trades after it. A contract can lag the books by a moment. It never holds up a session or a payment. A trade is recorded once, whoever tries, and a trade that broke off after two of its three agents is taken up at the third.

### Where the contracts are

| | Robinhood Chain testnet, which the site ran on until 30 September 2026 | Robinhood Chain mainnet, which the site runs on |
| --- | --- | --- |
| The Researcher's desk | `0x38b8f564aa603707580e091fa6f5b89ad11b6bc8` | `0xf543786e6f5793904245414aebc427c7ec090387` |
| The Observer's desk | `0x17c17353f7e2424a8560772b93c3d943c36f001e` | `0xf8a28d9ea736a2dfd4e425b17cfde845859b1675` |
| The Strategist's desk | `0x7fb674e69a48a8320b42c5d9c2ea0bb486f70bcb` | `0x5e9afd96d88d98b8efca96b57a5816854b1f61d9` |
| The Executor's desk | `0xf26d49310d513266f03967ace14b305154947348` | `0xc25d7c5980819a4da5286e75d9cd7393012862ae` |
| The share book | `0xf8f674caa3fed59528cf38ac7b294a8959ffdce9` | `0x57e2fd4848709acc6f43935cff028d0a4bc50102` |
| Treasury, which owns and operates them | `0xf7D07942E1F8633F54F9200CB3b54d05EE60dca2` | `0x883b885C8F70b733B1C134FF621B033697bAf1DF` |
| Funding token | test USDG `0xd656dd44e8f0270174a204d70b62a450950b1188` | USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| Explorer | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |

Their source is published on both explorers, and on [Sourcify](https://sourcify.dev) for mainnet, where it matches the deployed code exactly.

**The site uses the mainnet contracts.** Each agent's desk is given $20 of the house's USDG, and the treasury keeps a reserve to pay their gains from. The testnet contracts keep their record and their test USDG. [Deployment](#moving-to-mainnet) says how the move was made.

### Deploying

```bash
node --env-file=.env.local scripts/deploy-desks.mjs
```

| What the script does | |
| --- | --- |
| Deploys | The share book, then a desk for each agent, with the agent's name |
| Registers | Each desk with the share book |
| Approves | Lets each desk draw USDG from the treasury. `--no-approve` leaves this out |
| Writes | `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES`, `DESK_FROM_BLOCK` to the env file |

It can be run again if it broke off: what is already written to the file is not deployed twice. It refuses mainnet unless `ALLOW_MAINNET_FUNDING=true`.

The server puts each agent's cash, and the positions it already holds, into its contract the first time it runs with them.

### Replacing the contracts

Do it in this order. The old contracts must be closed last, because until the server runs with the new ones it would put the money back into the old.

1. Remove the four `DESK_<AGENT>` lines from the env file. Keep `DESK_SHARES` to reuse the share book.
2. Run `scripts/deploy-desks.mjs`.
3. Set the six settings on the host and deploy.
4. Wait until every agent's contract holds what the books say it should.
5. Close the old ones:

   ```bash
   node --env-file=.env.local scripts/retire-desks.mjs 0x<old desk> 0x<old desk> ...
   ```

Closing sells every position on the old contract at what it cost, so no gain or loss is settled, releases the agent's cash to the treasury, and strikes the contract off the share book. The books are not touched.

### Verifying the source

| Network | How |
| --- | --- |
| Testnet | The explorer's API accepts the source as standard JSON input |
| Mainnet | Sourcify's API accepts it, and Blockscout picks it up when the contract's page is opened. The mainnet explorer's own API refuses scripts |

### Testing

With [Foundry](https://book.getfoundry.sh) installed, in a folder with the contracts in `src/` and the tests in `test/`:

```bash
forge test --use 0.8.24 --optimize --evm-version paris
```

`contracts/test/AgentDesk.t.sol` holds 18 tests of an agent's desk. The tests of the old shared desk are beside it.

---

## 8. Funding, requests and rewards

### Funding an agent

A user deposits the funding token: USDG, or a test USDG on the testnet. The agent gets it as extra capital, and the user gets **shares** in that agent at the current value per share. Shares rise and fall with the agent's results. The user can withdraw whenever the agent has the cash free.

| Term | Default | Setting |
| --- | --- | --- |
| Deposit size | $5 to $500 per agent | `FUND_MIN_DEPOSIT`, `FUND_MAX_DEPOSIT` |
| First-deposit bonus, once per wallet | $5 → $1.30, $10 → $2, $25 → $3, $50 and up → $4.50 | `src/lib/funding.ts` |
| Bonus lock | 7 days. Withdrawing earlier gives it up | `BONUS_LOCK_HOURS` |
| Bonus budget | $50 per day across all users | `BONUS_DAILY_BUDGET_USD` |
| Route fee on withdrawal | $1 or 2%, whichever is more | `WITHDRAW_FEE_MIN_USD`, `WITHDRAW_FEE_PCT` |

Funding is for the testnet. It refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true`, which is not set: on the live site the fund page says that funding is switched off.

#### How a deposit works

1. The server says what to send: which token, how much, and to which address.
2. The wallet sends that transfer itself and reports the transaction's hash. The wallet pays the network fee in ETH, which is a small fraction of a cent.
3. The server reads the transaction from the chain and checks it: sent by this wallet, to the treasury, in the right token, for the exact amount, after the request was made, and not already used for another deposit.
4. The shares and the agent's books are written in one database statement, so they cannot drift apart.

#### How a withdrawal works

1. The user picks 25, 50, 75 or 100 percent of their shares and signs a text message naming the agent and the share. This is free and sends nothing.
2. The server verifies the signature, redeems the shares at the current value, deducts the route fee, and records the payment before sending it.
3. If the payment never lands, the shares are put back.

Withdrawals are paid from the agent's free cash. Cash inside an open position becomes free when that position closes.

The payment itself leaves the treasury. The agent's cash is held on its desk contract, so when the treasury holds less than the payment, the contract releases the difference to the treasury first, and then the payment is sent.

#### The faucet

On the testnet, with `FAUCET_ENABLED=true`, "Get free test USDG" sends a wallet 100 test USDG (`FAUCET_AMOUNT`) and a little ETH, so a new wallet can pay its first network fees.

#### What funding changes

It gives the agent more capital. Above $50 and $250 of users' funding it also raises how hard the model is allowed to think per session. **It does not make results better or safer, and the app never says it does.**

#### What the bonus costs

The bonus costs more than the fee brings in.

| First deposit | Bonus | Fee on withdrawing it all | Cost to the treasury |
| --- | --- | --- | --- |
| $5 | $1.30 | $1.00 | $0.30 |
| $10 | $2.00 | $1.00 | $1.00 |
| $25 | $3.00 | $1.00 | $2.00 |
| $50 | $4.50 | $1.00 | $3.50 |

It is a marketing cost, bounded by the lock, the once-per-wallet rule and the daily budget. Keep all three on.

### Trade requests

With a deposit, a funder may name a token on Robinhood Chain and ask the agent they fund to trade it. It can be any of Robinhood's Stock Tokens, named by symbol (such as MSFT), or any other token, named by its contract address.

| Deposit | What happens |
| --- | --- |
| Under $20 | **Suggestion.** The agent puts the token to the council once. All four agents weigh it, and it is bought only if three of them back it. If it is voted down there is no trade, and the funding stays with the agent |
| $20 or more | **Commitment.** The agent buys the token with its own cash, up to the amount funded. Nobody votes on whether to trade. The other agents answer **IN** or **OUT** with their own cash |

The threshold is `REQUEST_COMMIT_FROM_USD`.

#### How a request moves through the system

| Step | What happens |
| --- | --- |
| 1. Lookup | The fund page shows the token's name, price, liquidity and daily volume before the user deposits |
| 2. Checks | The token must clear the limits below |
| 3. Queue | Once the deposit is confirmed, the request waits. One request is heard per session, oldest first. A wallet can have one request waiting at a time |
| 4. Hearing | The checks run again. The request is dropped if the funding behind it was withdrawn. A request for a Stock Token waits while its market is closed, and those behind it go ahead |
| 5. Session | Every agent speaks to the requested token, so the request is the whole desk's business |
| 6. Outcome | The funder sees the result, with the reason, in their request list |

#### What can be asked for

| Check | On the testnet | On mainnet |
| --- | --- | --- |
| A Stock Token | Active and not halted | The same |
| Any other token: a live price | Required | Required |
| Enough history for the agents to read | About three hours of trading on record | The same |
| The pool holds at least | any amount | $50,000 |
| It traded in the last day at least | $100 | $10,000 |
| The pool is at least this old | any age | a day |

The last three are `REQUEST_MIN_LIQUIDITY_USD`, `REQUEST_MIN_VOLUME_USD` and `REQUEST_MIN_AGE_HOURS`.

Refused in every case: USDG, which is the desk's own money, and an address where no token trades.

#### Other details

- A committed purchase is held for 12 sessions before the council may vote to sell it. Its stop and target still close it at any time.
- A request for a token the desk already holds adds to the position, and the debate is skipped.
- Anyone can launch a token called TSLA. A token that borrows a Stock Token's symbol is given a longer name, such as `TSLA.A1B2`.
- If the token's market data cannot be reached, the request keeps its place and is tried again, six times at most.
- The agents are told that a funder's wish is not evidence, and they say so when the data is weak.
- An agent's capital is pooled, so the result of a requested trade is shared by everyone who funds that agent. This is why a small request cannot force a trade. The fund page says so.
- A thinly traded token is filled at the quoted price, however little of it a real order could buy there. The agents are shown its liquidity and volume.

The queue is in the `trade_requests` table. The logic is in `src/server/requests/service.ts` and `src/server/council/round.ts`.

### Rewards

On `/claim` a user connects a wallet, backs an agent and signs a free message. The server verifies the signature and sends the reward from the treasury, which also pays the network fee.

| Limit | Default | Setting |
| --- | --- | --- |
| Reward | 1.5 USDG | `REWARD_USDG` |
| Claims per wallet | one, ever | |
| Claims per day, across all users | 100 | `DAILY_CLAIM_CAP` |
| Claims per IP address per day | 3 | `IP_DAILY_LIMIT` |
| Past transactions the wallet needs | none on the testnet, 5 on mainnet | `MIN_WALLET_TXS` |
| Captcha | off | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |

With no treasury key set, the page runs in demo mode: the signature is verified, but nothing is sent.

A claim is recorded before it is paid. If the payment's fate is unknown, the server asks the chain before it tells the user anything, so a claim is never paid twice.

### Wallets

The app runs on Robinhood Chain only. Wallets connect through [Privy](https://privy.io), and transfers are sent with viem. Any Ethereum-type wallet works. Privy's window lists MetaMask and Robinhood Wallet first, then every other wallet installed in the browser, then WalletConnect for phone wallets.

| Network | Chain ID | Explorer |
| --- | --- | --- |
| Robinhood Chain Testnet (the default) | 46630 | explorer.testnet.chain.robinhood.com |
| Robinhood Chain | 4663 | robinhoodchain.blockscout.com |

- Privy needs the app's ID in `NEXT_PUBLIC_PRIVY_APP_ID`, from <https://dashboard.privy.io>. The ID is public. Without it no wallet can connect, and the Connect button says so.
- Every address the site is served from must be on the app's list of allowed domains in Privy's dashboard, `http://localhost:3000` included for development. From any other address Privy refuses the sign-in.
- Connecting signs the wallet in: the wallet shows a free message to sign, which proves the address to Privy, and Privy keeps the address as a user of the app. Only wallets are offered, with no email or social sign-in, and Privy makes no wallet of its own.
- The site takes the wallet that signed in as the connected one. If the wallet is locked or moved to another account, the site shows it as disconnected, and connecting again signs in afresh.
- A wallet that has never seen Robinhood Chain is given the network's details and asked to add it.
- Robinhood Wallet is a phone app. It connects by QR code through WalletConnect, which Privy provides.
- The wallet stays signed in on the next visit, until Disconnect is pressed.
- A deposit is a transfer the wallet sends itself, so the wallet needs a little ETH for the network fee.

---

## 9. Website and displays

### The pages

| Page | What it is | Who can open it |
| --- | --- | --- |
| `/` | The trading floor, the chart, the agents, positions, the conversation and the order history | Anyone |
| `/fund` | Fund an agent, ask for a trade, withdraw | Anyone with a wallet |
| `/claim` | Rewards | Anyone with a wallet |
| `/docs` | The documentation for visitors: the council, the agents, the rules, and each agent's contract | Anyone |
| `/kiosk` | The floor on one screen, for a wall display or a Raspberry Pi | Anyone |
| `/admin` | The admin's display | The admin only |
| `/admin/login` | The sign-in for it | Anyone |

### The name and the mark

The site's name and its account on X are kept in one place, `src/lib/brand.ts` (`BRAND`, `X_HANDLE`, `X_URL`). Page titles, the header, the display pages, the wallet window, the messages a wallet signs and the agents' prompts read the name from there.

The mark (a robot's head with an antenna, two eyes and a bolt) is `src/components/site/logo.tsx`, drawn in the theme's ink colour. The same mark is the browser's icon: `src/app/favicon.ico`, `icon.png` and `apple-icon.png`.

The account on X is linked from the header (a round button beside the theme switch, from 440px of width), from the footer on every page, and from the top of the documentation page.

### The loading screen

Every page opens on the loading screen: the mark draws itself (the outline of the head, the eyes, then the bolt) over the whole page. It is a short film that repeats, `public/loader/loader.mp4` with `loader.webm` for browsers that can't play the first, shown by `src/components/site/site-loader.tsx` from the root layout.

It stays until the first prices are in, and for at least 1.3 seconds so the mark is drawn once; the price feed gives up 4 seconds after the page's scripts start, so it never waits on prices for longer than that. It is shown once for each time the site is loaded, not again when moving between pages. The film is white on black, and the light theme shows it inverted.

### The documentation page

`/docs` is what a visitor reads: the council, the four agents and how each trades, a session step by step, the agents' contracts with their addresses, what is traded, the rules, funding, and what is real. The header and the footer link to it.

The page states the desk's own numbers and does not keep a copy of them. `src/server/docs.ts` reads them when the page is asked for:

| What the page shows | Where it comes from |
| --- | --- |
| The contracts' addresses on the network the site runs on | The server's settings: `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES`, `USDG_ADDRESS`, and the treasury's key |
| The addresses on the other network, and those shown when a setting is missing | `src/lib/deployments.ts` |
| Deposit limits, bonus, fees, the request threshold | `fundConfig()` |
| Stops and targets | `STOP_RANGE` and `TARGET_RANGE` in `brain.ts` |
| How far a token falls before each agent sells | `NERVE` in `risk.ts` |
| The board's limits, the session interval, the reward, the faucet | Their own settings |

What each contract holds, and whether it is fully backed, is added in the browser from the desk's state, the same figures the agents' cards show.

When contracts are deployed again on a network the site does not run on, change their addresses in `src/lib/deployments.ts`. The words about each agent are in `src/components/docs/agent-profiles.tsx`, and the rest of the text in `src/components/docs/docs.tsx`.

### The front page

On a screen 1280 pixels wide or more, the whole desk fits on one screen with nothing to scroll:

| Left | Middle | Right |
| --- | --- | --- |
| The agents' cards, best result first | The stages of the session | The conversation |
| Open positions | The trading floor | The latest trades |
| | The price chart | |

The full order history is below it.

On a phone the same parts follow one another: the floor first, then the conversation, the chart, the agents, the latest trades and the open positions.

#### An agent's card

Each card shows the agent's name and rank, its model, what it is doing, its result in USDG and percent, the money it has in trades, what users have funded it with, a button to fund it, and a link to its desk contract with the contract's balance.

#### The trading floor

The browser plays each session like a short scene (`src/lib/director.ts`).

- Agents are characters with desks. They walk to the leader's desk to argue, carry coins over when they pledge cash, and gather at the table to vote.
- One agent has the floor at a time: a speech bubble closes when another agent speaks.
- A vote shows as a sign over the agent's head. The reason for it is in the conversation.
- Each agent's face follows what is happening to it. See [Agents and sessions](#the-agents-faces).
- The chart follows whichever token the council is debating, and marks the desk's trades with arrows.

#### The trade lists: gains first, everything on request

The latest trades and the order history have a switch, **Gains** or **All**, and both lists follow it.

- **Gains**, what a visitor sees first: only the sales that booked a gain. The list on the desk is headed "Winning trades" and says how many of the closed trades that is ("16 of 52 closed trades"). The order history says the same in a sentence, with a link to show all.
- **All**: every order, purchases and losing sales included, with the count of orders, gains and losses.

The choice is kept in the browser (`council:trades`). It changes what the two lists show and nothing else: an agent's result, the desk's totals, the positions, the chart's arrows, the conversation and the admin's `trades.log` are worked out from every trade, whichever view is on. The view is a filter in the page (`src/lib/trade-view.ts`); the server sends every order either way.

#### The conversation is kept, and shown to everyone

Every session is saved in the database. When anyone opens the site, on any device, the last six sessions' conversation is put on the page at once, and "Show earlier sessions" reads further back.

A session is played **once per browser**. Coming back to the floor shows it as history instead of playing it again. After a refresh in the middle of a session, the lines already watched are put back at once and the session carries on from there. The show runs above the pages, so moving between them doesn't interrupt it. A first-time visitor sees the latest session as a replay, marked as one.

#### The header's badge

| Badge | Meaning |
| --- | --- |
| LIVE AI MODELS · SETTLED ON-CHAIN | The agents are on their models, and trades are recorded on their contracts |
| SCRIPTED AGENTS | The agents are on scripted rules. The badge says why |

#### How it looks

The site is black and white, in a dark and a light theme. The button in the header switches between them and the choice is kept in the browser. Colour is used only on the agents' characters, and green and red on gains and losses. The trading floor is a lit stage and stays dark in both themes.

### The Raspberry Pi display

`/kiosk` is the floor laid out for one screen with no scrolling, with the leaderboard, the conversation and the positions beside it. Anyone can open it. It hides the cursor after three seconds and switches off blur and glow effects that a Pi's graphics chip handles poorly.

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://<your-site>/kiosk
```

Turn off screen blanking in `raspi-config` so the display stays on. A Pi 4 or 5 with a 1080p screen is the target.

### The admin's display

`/admin` is one page for the person who runs the desk, made to be left on a Raspberry Pi's screen. Only the admin can open it.

#### What is on the screen

| Part | What it shows |
| --- | --- |
| Top line | Session number and stage, time to the next session, pool equity and result, whether the agents are on their AI models, the clock, who is signed in |
| Prices | The tokens on the board and those held, running under the top line |
| The floor | The council, as on the front page |
| Agents | Each agent's model, what it is doing, its result, cash, money in trades, and its contract's address and balance |
| `trades.log` | Every trade, the newest written at the bottom |
| `positions` | What is held |
| `system` | The state of what the desk runs on |

The three panes are set as a terminal shows them.

#### `trades.log`

| Column | What it is |
| --- | --- |
| time | When the trade was made |
| side | BUY in green, SELL in red |
| token | What was traded |
| size | In USDG |
| price | The price it was settled at |
| led by | The agent who led it |
| why | `council`, `own`, `stop`, `target` or `falling` |
| result | The gain or loss a sale booked. `open` for a purchase |
| chain | How many of the agents in the trade have it on record on their contracts, such as `3/3`. It links to the first transaction |

A sale made between sessions has a second line that says why.

#### `positions`

For each position: the token, what it cost, the price paid and the price now, the gain or loss, a gauge of where the price sits between the stop and the target (`|` is the entry, `●` the price now), who holds it, and for how long. Up to five are shown.

#### `system`

A line turns red when something needs attention.

| Line | What it shows | Red when |
| --- | --- | --- |
| agents | Whether the agents are on their AI models | They are on scripted rules |
| gateway | Whether the gateway answers, and sessions run on models today against the day's limit | No key, budget used up, models not answering, or the day's limit reached |
| last run | When the last session and the last risk check were | |
| prices | Whether the price feed is live, and how many tokens are watched | The feed can't be reached |
| contracts | The network, whether every contract holds what it owes, what they hold together, and trades waiting to be recorded | A contract holds less than it owes, or a trade could not be recorded |
| treasury | Its address, its ETH for gas, and its USDG | Gas is under 0.002 ETH |
| server | The version running, how long it has been up, and the database | There is no database |

#### The account

There is one account. It lives in three settings, made with:

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

| Option | What it does |
| --- | --- |
| none | Makes up a password of 20 characters |
| `--ask` | Lets you type the password, unseen. At least 12 characters |
| `--user <name>` | Another username than `admin` |
| `--out <file>` | Writes the settings and the password to a file and prints nothing secret |

The file holds `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`, with the password on its third line. Set the three on the server. The server keeps only a hash of the password, so the password cannot be read back from it.

| Rule | Value |
| --- | --- |
| Wrong guesses before an address is locked out | 5 in a quarter of an hour |
| Wrong guesses from everywhere before nobody may try | 40 in a quarter of an hour |
| How long a browser stays signed in | 90 days after it was last used |
| The cookie | `council_admin`. Page scripts cannot read it, and it is sent over HTTPS only |

#### On the Pi

Sign in once with a keyboard, then start the browser on the page:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://<your-site>/admin
```

- The browser must keep its cookies between restarts, so don't start it with `--incognito`.
- The page loads itself afresh after a new version of the site goes live, and every six hours. It does so between sessions only.
- On a screen narrower than 1024 pixels the page scrolls instead of fitting one screen.
- A display that is left open keeps the desk running, since sessions start while a page is open. That costs model calls around the clock.

#### What the display does not do

It shows. It does not control. There is no button to pause the desk, start a session or change a setting.

### Where things live in the code

```
src/
  app/                 pages and server routes
  components/
    arena/             the floor: characters, desks, table, speech, transcript
    market/            the price chart
    fund/              the fund page
    claim/             the rewards page
    docs/              the documentation page
    kiosk/             the full-screen display
    admin/             the admin's display and its sign-in
    wallet/            wallet connection, through Privy
    home/, site/       header, footer, ticker, summary cards
  lib/                 shared by server and browser
    agents.ts            the agents' names, models and colours
    deployments.ts       where the contracts are deployed, on both networks
    council.ts           the desk's accounting
    council-types.ts     the stages the server sends the browser
    director.ts          how a session is staged in the browser
    mood.ts              which face fits which moment
    funding.ts           the arithmetic of bonuses and fees
    market.ts            price feeds, and the tokens the desk used to list
    assets.ts            pool tokens and requested tokens
  server/
    council/           session engine, agents' brains, risk, memory, state
    admin/             the admin's account, sign-in and status
    fund/              deposits, withdrawals, bonuses, faucet
    requests/          the trade request queue
    rewards/           reward claims and payouts
    chains/            everything that touches Robinhood Chain, the desk contracts included
    market/            the board, quotes, candles
    db.ts              database connection and tables
    docs.ts            the facts the documentation page states, read from the settings
    dns-fallback.ts    name lookups that don't give up too early
  store/               the browser's state (floor and prices)
contracts/             the contracts, their compiled code and their tests
scripts/               setup, deployment and the admin account
docs/                  this document
```

---

## 10. API reference

Every route is served by the same Next.js app, under `/api`. They take and return JSON. No route needs a key. Routes that move money need a signature from the wallet concerned, and the admin's route needs the admin's sign-in.

### How answers are shaped

| Kind of route | When it works | When it doesn't |
| --- | --- | --- |
| Reading | `200` with the data | `400` for a bad request, `502` when an outside service can't be reached, each with `{ "error": "..." }` |
| Funding and rewards | `200` with `{ "ok": true, ... }` | `400` and up with `{ "ok": false, "error": "..." }` |

The `error` is a sentence meant for the person using the page.

Nothing that is read is cached: the reading routes send `cache-control: no-store`.

### All routes

| Route | Purpose |
| --- | --- |
| [`GET /api/health`](#health) | Says the server is up |
| [`GET /api/council/state`](#the-desk-as-it-stands) | The desk as it stands now |
| [`POST /api/council/round`](#the-session-to-watch) | The session to watch, streamed stage by stage, or how long to wait |
| [`GET /api/council/round?round=N`](#a-finished-session) | The record of a finished session |
| [`GET /api/council/history`](#past-sessions) | Past sessions, newest first |
| [`GET /api/market/quotes`](#quotes) | Live quotes for the board and for what the desk holds |
| [`GET /api/market/candles`](#candles-1) | Candles for a token |
| [`GET /api/market/asset`](#look-up-a-token) | Looks up a token a funder may ask for |
| [`GET /api/fund/status`](#funding-status) | Funding terms, agents' figures, and one wallet's holdings |
| [`POST /api/fund/deposit`](#deposit) | Two steps: prepare, then confirm |
| [`POST /api/fund/withdraw`](#withdraw) | Two steps: challenge, then submit |
| [`POST /api/fund/faucet`](#faucet) | Free test tokens, on the testnet |
| [`GET /api/rewards/status`](#rewards-status) | Whether rewards can be paid, and one wallet's claim |
| [`POST /api/rewards/challenge`](#reward-challenge) | The message to sign |
| [`POST /api/rewards/claim`](#reward-claim) | Verifies and pays |
| [`GET /api/admin/status`](#admin-status) | The state of what the desk runs on. Admin only |

---

### The council

#### Health

`GET /api/health`

Returns `{ "ok": true }`. The host asks it to decide whether a deploy is healthy. It touches nothing else.

#### The desk as it stands

`GET /api/council/state`

Reading it also runs the checks between sessions: stops, targets and falling prices. See [Rules and risk](#between-sessions).

| Field | What it is |
| --- | --- |
| `mode` | `live` when the agents are on their models, `scripted` when they are not |
| `modeNote` | Why they are not, or `null` |
| `models` | For each agent, its model's `id` and `name` |
| `round` | The number of the latest session |
| `portfolio` | The books: `cash`, `capital` and `shares` per agent, and `positions` |
| `desk` | The agents' contracts: network, each agent's address and balance, whether they hold what they owe. `null` if none are deployed |
| `board` | The tokens the agents chose from in the latest session |
| `assets` | The tokens the desk knows, with the last price seen for each |
| `fills` | The latest trades on record, up to 100 |
| `nextRoundAt` | When the next session is due, in milliseconds |
| `intervalMs` | The time between sessions |
| `serverTime` | The server's clock |

A **position** carries `token`, `qty`, `cost`, `entryPrice`, `stake` and `units` per agent, `stop`, `target`, `openedRound`, `openedAt`, `leader`, and `lockedUntil` for a purchase made on a commitment.

A **fill** carries `id`, `round`, `ts`, `side`, `token`, `qty`, `price`, `usd`, `reason`, `leader`, `realized` (`null` for a purchase), `stake` and `units` per agent, `fraction` for a sale, `note`, and `txs`: the transaction on each agent's contract.

#### The session to watch

`POST /api/council/round`

| Send | |
| --- | --- |
| `seen` | The number of the latest session this browser has watched. `0` if none |

It answers in one of two ways:

| Answer | Meaning |
| --- | --- |
| `{ "wait": 12000, "nextRoundAt": ... }` | No session is due. Ask again in `wait` milliseconds |
| A stream of lines, each a JSON object | A session. Each line is one stage, sent as it is ready. The content type is `application/x-ndjson` |

The header `x-council-replay` is `1` when the session had already ended and is being shown as a replay.

The stages, in order:

| `stage` | What it carries |
| --- | --- |
| `open` | `round`, `mode`, the board's figures in `stats`, the books, the funder's request if there is one, and what was sold before the session |
| `pitches` | Every agent's pitch, and the `proposal` or `null` |
| `debate` | The `exchanges`: a challenge and the leader's reply |
| `decision` | The `pledges`, the leader's `closing` line, the `votes`, and whether it was `approved` |
| `outcome` | The `fill` or `null`, the books after it, a `note`, and the trades the agents made for their `own` books |
| `error` | A `message`. The session failed |

The exact types are in `src/lib/council-types.ts`.

**Asking for a session is what starts one.** If the interval has passed, the first request starts the next session and every other request follows it.

#### A finished session

`GET /api/council/round?round=56`

Returns `{ "stages": [...] }`, the same stages as above. `404` if that session is not on record.

#### Past sessions

`GET /api/council/history?before=56&limit=6`

| Parameter | Default | What it is |
| --- | --- | --- |
| `before` | the latest | Sessions earlier than this number |
| `limit` | 6 | How many. At most 12 |

Returns `{ "sessions": [{ "round": 55, "stages": [...] }, ...], "more": true }`, newest first. `more` says whether there are older ones.

---

### Market

#### Quotes

`GET /api/market/quotes`

Returns `{ "quotes": { "ROO": { "price": ..., "change24h": ..., "change1h": ..., "change5m": ... }, ... } }` for the tokens on the board and the tokens the desk holds. `502` when no market data can be reached.

#### Candles

`GET /api/market/candles?token=ROO&interval=5m`

| Parameter | What it is |
| --- | --- |
| `token` | A token on the board, one the desk holds, or one a funder asked for |
| `interval` | `1m`, `5m`, `15m` or `1h` |

Returns `{ "candles": [...] }`, up to 300 of them. `400` for an unknown token or interval.

#### Look up a token

`GET /api/market/asset?token=0x...` or `?token=MSFT`

Returns `{ "ok": true, "asset": {...}, "quote": {...} }` when the token can be asked for, and `{ "ok": false, "error": "..." }` with the reason when it can't.

| In `asset` | What it is |
| --- | --- |
| `key` | The name the desk uses for the token |
| `symbol`, `name`, `address` | As on the chain |
| `kind` | `stock` for a Stock Token, `pool` for any other |
| `pool` | The pool its price comes from |

| In `quote` | What it is |
| --- | --- |
| `price`, `change24h` | |
| `liquidityUsd` | What the pool holds. `null` for a Stock Token |
| `volume24hUsd` | |

---

### Funding

#### Funding status

`GET /api/fund/status?wallet=0x...`

`wallet` is optional.

| Field | What it is |
| --- | --- |
| `chain` | The network, the funding token's name, whether funding is `enabled` and the `reason` if not, whether the `faucet` is on |
| `terms` | Deposit limits, bonus tiers, fee, lock, commitment threshold |
| `agents` | For each agent: value per share, return, users' funding, free cash, analysis level |
| `wallet` | For the wallet given: its balance, its positions, its bonus, its deposits and withdrawals, its requests. `null` without a wallet |

#### Deposit

`POST /api/fund/deposit`

**Step 1: prepare**

| Send | |
| --- | --- |
| `step` | `"prepare"` |
| `wallet` | The depositor's address |
| `agent` | `quant`, `guardian`, `degen` or `oracle` |
| `usd` | The amount |
| `token` | Optional. The token to ask the agent to trade: an address, or a Stock Token's symbol |

Returns `intentId`, and `deposit`: the transfer the wallet must send, with the chain, the token, the address to send to, and the amount in the token's smallest unit. If a token was named, `request` describes the request.

**Step 2: confirm**, after the wallet has sent the transfer

| Send | |
| --- | --- |
| `step` | `"confirm"` |
| `intentId` | From step 1 |
| `proof` | `{ "kind": "robinhood", "hash": "0x..." }`, the transfer's transaction |

Returns `usd`, the `shares` bought, the value per share, the `bonus` if one was earned, and the `request` if one was made.

#### Withdraw

`POST /api/fund/withdraw`

**Step 1: challenge**

| Send | |
| --- | --- |
| `step` | `"challenge"` |
| `wallet`, `agent` | |
| `percent` | `25`, `50`, `75` or `100` |

Returns a `message` for the wallet to sign and a `token` that goes with it.

**Step 2: submit**

| Send | |
| --- | --- |
| `step` | `"submit"` |
| `wallet`, `agent`, `percent` | As in step 1 |
| `message`, `token` | From step 1 |
| `signature` | The wallet's signature of the message |

Returns the payment's `signature` (its transaction), the `gross` amount, the `fee`, what was `received`, and `pending` if the payment is not confirmed yet.

#### Faucet

`POST /api/fund/faucet` with `{ "wallet": "0x..." }`

Testnet only. Returns the transaction and the amount sent.

---

### Rewards

#### Rewards status

`GET /api/rewards/status?wallet=0x...`

| Field | What it is |
| --- | --- |
| `mode` | `live`, or `demo` when no treasury is configured |
| `amount` | USDG per claim |
| `remainingToday` | Claims left today |
| `captchaSiteKey` | Set when the captcha is on |
| `problem` | Why rewards can't be paid right now, or `null` |
| `claim` | This wallet's claim, or `null` |

#### Reward challenge

`POST /api/rewards/challenge` with `{ "wallet": "0x...", "agent": "quant" }`

Returns a `message` to sign and a `token`.

#### Reward claim

`POST /api/rewards/claim`

| Send | |
| --- | --- |
| `wallet`, `agent` | |
| `message`, `token` | From the challenge |
| `signature` | The wallet's signature |
| `captcha` | The captcha's answer, when the captcha is on |

| Status | Meaning |
| --- | --- |
| `200` | Paid, or accepted in demo mode |
| `400` | The request or the message is wrong |
| `401` | The signature doesn't match the wallet |
| `403` | The captcha failed, or the wallet is too new |
| `409` | This wallet has already claimed |
| `429` | Today's claims are used up, or too many from this network |
| `502`, `503` | The chain can't be reached, the pool is empty, or the payment did not go through |

---

### Admin

#### Admin status

`GET /api/admin/status`

Needs the admin's cookie. `401` without it. Asking also renews a cookie that is more than a day old.

| Field | What it is |
| --- | --- |
| `user` | Who is signed in |
| `serverTime`, `startedAt` | The server's clock, and when it last started |
| `version` | The commit it was built from |
| `network` | The network the desk's money is on |
| `database` | Whether there is one |
| `gateway` | `hasKey`, and `outOfBudget` when the gateway has refused for lack of budget in the last quarter of an hour |
| `sessions` | Sessions run on models `today`, the most `perDay`, when the last session was, when the last risk check was |
| `treasury` | Its address, its ETH for `gas`, its `usdg` |

Signing in and out are not routes. They are server actions of the sign-in page (`src/app/admin/actions.ts`).

---

## 11. Storage

Storage is Postgres on [Neon](https://neon.tech). Tables are created the first time they are used (`src/server/db.ts`). The connection string stays on the server and never reaches browser code.

### The tables

| Table | Holds |
| --- | --- |
| `council_state` | The desk's books, in one row: cash, capital, shares, positions, fills, the board, the session number |
| `council_rounds` | Every session's stages, for replay and history |
| `agent_lines` | What each agent said, for the repeat checks |
| `fund_positions` | Each wallet's shares and principal per agent |
| `fund_events` | Deposits, withdrawals and faucet grants |
| `fund_bonuses` | First-deposit bonuses and their state |
| `fund_intents` | Deposits that were prepared, and any request attached |
| `trade_requests` | The request queue and each request's outcome |
| `reward_claims` | Reward claims |

### What the books keep

The books are one document (`CouncilState` in `src/server/council/store.ts`).

| Part | What it is | How much is kept |
| --- | --- | --- |
| `network` | The network the books were made on. A server set to the other network refuses to open them, so test money is never read as real money | |
| `round` | The number of the latest session | |
| `portfolio` | Each agent's cash, capital and shares, and the open positions | |
| `assets` | The tokens the desk knows | Those on the board and those held, and the 20 most recent others |
| `board` | The tokens of the latest session | |
| `fills` | Trades on record | The latest 100 |
| `recent` | One line per finished session, given to the agents as memory | The latest 5 |
| `lenses` | The focus each agent was given lately | |
| `lastRoundAt`, `lastRiskCheck` | When the last session and the last check were | |
| `desk` | Which set of contracts the books were last brought in step with, and since when | |
| `day`, `roundsToday` | Sessions run on models today | |

Older trades leave the books but not the chain: every trade recorded on a contract stays on it.

### How the money records are protected

| Safeguard | What it prevents |
| --- | --- |
| The books carry a version number. A change is saved only if the version is still the one that was read | Two servers overwriting each other |
| A session is claimed by saving the books. The save succeeds for one server only | Two sessions at once |
| Shares and the agent's books are written in one database statement | A deposit credited to the funder but not to the agent, or the other way round |
| Every payout records its transaction before it is sent | A crash paying twice |
| A deposit's transaction can be used once | One transfer credited twice |
| Each contract keeps the id of every trade on it | A trade recorded twice on-chain |

### Without a database

The desk's state is kept in a local file, `.data/council.json`, and sessions are kept in memory. Funding and rewards are off. This is for running the floor on your own computer.

### The database is the live desk's

A server started with the hosted site's `DATABASE_URL` reads and writes the live books, and applies stops and falling exits to them. For development, use a database of your own or none.

### Backups

Neon keeps a history of the database that a point in time can be restored from. How far back depends on the plan. Nothing in the app makes backups of its own.

---

## 12. Deployment

### How the site is hosted

| | |
| --- | --- |
| Host | [Render](https://render.com), a Node web service on the free plan |
| Address | <https://the-council-zvys.onrender.com> |
| Code | `github.com/saurabh-sol/New-project`, branch `main` |
| Deploys | Automatically, on every push to `main`. A deploy takes about three minutes |
| Build | `npm ci && npm run build` |
| Start | `npm run start` |
| Health check | `/api/health` |
| Node | 22 |
| Database | Postgres on Neon |
| Network | Robinhood Chain mainnet |

`render.yaml` describes the service. It names every setting the service needs. The secret ones are marked `sync: false`: their values are set in Render's dashboard and are never in the file.

### Deploying a change

1. Commit the change and push it to `main`.
2. Render builds and starts the new version. The old one keeps serving until the new one answers its health check.
3. An admin display that is open loads the new version by itself, between sessions.

Build minutes on the free plan are limited. Push finished work, not every small step.

### Settings on the host

Set in the service's **Environment** page on Render:

| Group | Settings |
| --- | --- |
| Agents | `AI_GATEWAY_API_KEY` |
| Database | `DATABASE_URL` |
| Chain | `ROBINHOOD_NETWORK`, `NEXT_PUBLIC_ROBINHOOD_NETWORK`, `TREASURY_PRIVATE_KEY`, `USDG_ADDRESS` |
| Contracts | `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES`, `DESK_FROM_BLOCK` |
| Funding and rewards | `CLAIM_SECRET`, `FAUCET_ENABLED`, `BONUS_LOCK_HOURS` |
| Admin | `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` |

[Configuration](#3-configuration) explains each. Anything not set takes its default, the agents' models included.

Three things to know:

- **Values that start with `NEXT_PUBLIC_` are fixed when the site is built.** Change one, and the service must be deployed again.
- **Changing a setting does not deploy by itself.** Deploy from the dashboard afterwards, or push a commit.
- **Run one server per treasury.** Two servers paying from the same wallet at once can take each other's place in its queue of transactions.

### The free plan sleeps

On Render's free plan the service sleeps after about a quarter of an hour without visitors. The first visit after that takes about a minute. While it sleeps, no session runs and no stop is checked.

| To keep the desk running | What it takes |
| --- | --- |
| Leave a display open | A Raspberry Pi on `/admin` or `/kiosk` keeps the server awake and the sessions running |
| A paid plan | The server stays awake, but sessions still need an open page to start them |

Either way, a desk that runs around the clock makes model calls around the clock. See [What it costs](#what-it-costs).

### The Raspberry Pi

A Pi 4 or 5 with a 1080p screen is the target.

1. Install Raspberry Pi OS with a desktop.
2. Turn off screen blanking in `raspi-config`, so the display stays on.
3. For the admin's display, open the site in Chromium, sign in once with a keyboard, and close the browser.
4. Start the browser full screen when the Pi starts. Put this in the desktop's autostart:

   ```bash
   chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://the-council-zvys.onrender.com/admin
   ```

   Use `/kiosk` instead of `/admin` for the public display, which needs no sign-in.

Do not start Chromium with `--incognito` for the admin's display. It has to keep its cookie between restarts.

The page fits one screen at 1280 by 720 and larger. On a narrower screen, such as the 7-inch Pi display, it scrolls.

### Another host

The app is a plain Next.js server. Any host that runs Node 20.9 or newer and keeps a process running will do. Two things to check:

- **The per-IP limits trust the `x-forwarded-for` header.** The server must sit behind a proxy you control, which sets it.
- **A session can take a minute.** A host that cuts requests off sooner will cut sessions short. The session route asks for up to five minutes.

### Moving to mainnet

The site was moved to mainnet on 30 September 2026, with the house's money only: `NEXT_PUBLIC_START_CASH=20`, funding off, rewards off, and new books in a database of their own. The testnet's books are kept in the old database and are not used.

Pointing a site at mainnet is a decision, not a switch, because with real USDG an agent's gain is the treasury's loss. What it takes:

| Step | What to do |
| --- | --- |
| 1. Capital | The treasury needs USDG for the agents' capital, plus a reserve for their gains. With the default that is $100 for each agent, so $400. To start smaller, set `NEXT_PUBLIC_START_CASH`: with `20`, $100 covers the four agents ($80) and leaves $20 in the treasury as the reserve |
| 2. Gas | The treasury needs ETH on mainnet for the network fees. A full cycle of funding, trades and taking the money out costs about 0.0001 ETH |
| 3. Allowance | Run `scripts/deploy-desks.mjs` once more against the mainnet env file, without `--no-approve`, to let the contracts draw USDG from the treasury. The script asks for `ALLOW_MAINNET_FUNDING=true` in its own shell. Do not set that on the host for this |
| 4. Books | Start new books in an empty database. The server refuses to open the testnet's books on mainnet: their test deposits would otherwise count as real USDG |
| 5. Settings | On the host, set `ROBINHOOD_NETWORK` and `NEXT_PUBLIC_ROBINHOOD_NETWORK` to `mainnet`, the new `DATABASE_URL`, the mainnet treasury key and the mainnet `DESK_` addresses, turn `FAUCET_ENABLED` off, and deploy |
| 6. Rewards | Set `DAILY_CLAIM_CAP=0`. The claim page is not covered by `ALLOW_MAINNET_FUNDING`, and would pay real USDG once the treasury holds some |
| 7. Funding | Leave `ALLOW_MAINNET_FUNDING` off unless you mean to hold users' money. See [Security and limits](#14-security-and-limits) |
| 8. Ownership | Hand the contracts to a key that was never shared, with `setOwner`, `setOperator` and `setTreasury` |

With the house's money only, nothing is won or lost overall. An agent's gain is paid by the treasury and its loss is paid to the treasury, and both are yours, so the desks and the treasury always hold between them what was put in. Only network fees leave. The money can be taken out at any time: see [Take the desk's money out](#take-the-desks-money-out).

This was rehearsed on a local copy of mainnet with the real contracts and the real USDG: $100 in, $20 to each desk, a gain, a loss, a position left open, and $100.000000 back in a wallet.

Do not do this before reading [Security and limits](#14-security-and-limits).

---

## 13. Operations

How to run the desk day to day: what to look at, how to do the common tasks, and what to do when something stops.

### Where to look

| To see | Look at |
| --- | --- |
| Everything at once | The admin's display, `/admin`. Its `system` pane turns a line red when something needs attention |
| Whether the agents are on their models | The header's badge on the front page |
| An agent's money on-chain | Its contract on the explorer, linked from its card |
| The server's own messages | The service's **Logs** on Render |
| What the models cost | Vercel, under AI Gateway |
| The database | Neon's console |

### A daily check

Open `/admin` and read the `system` pane.

| Line | It should say | If it doesn't |
| --- | --- | --- |
| agents | on their AI models | See [The agents are scripted](#the-agents-are-scripted) |
| gateway | answering, with sessions left today | The same |
| last run | A session in the last few minutes, while a page is open | See [No session starts](#no-session-starts) |
| prices | live | See [Prices or the board are missing](#prices-or-the-board-are-missing) |
| contracts | all hold what they owe | See [A contract holds less than it owes](#a-contract-holds-less-than-it-owes) |
| treasury | gas above 0.002 ETH, and USDG to pay gains | See [Top up the treasury](#top-up-the-treasury) |
| server | database ok | Check `DATABASE_URL` on the host, and Neon |

### What it costs

| | |
| --- | --- |
| One session | About 18 model calls. It was roughly $0.10 to $0.20 at 12 calls, and has not been measured since |
| An hour with a page open, at the default interval | 12 sessions, about $1 to $2.50 |
| A day at the default limit of 100 sessions | About $10 to $20 at most |
| Funded agents | Think harder, which costs more per session |
| Gas | A fraction of a cent per transaction on Robinhood Chain |
| Market data | Free |

One session is produced per interval no matter how many people are watching. Two settings bound the spend: `COUNCIL_MAX_ROUNDS_PER_DAY` and the budget set on the gateway key in Vercel.

### Common tasks

#### Change an agent's model

1. Find the model's name at <https://ai-gateway.vercel.sh/v1/models>.
2. Either set `COUNCIL_MODEL_QUANT`, `COUNCIL_MODEL_GUARDIAN`, `COUNCIL_MODEL_DEGEN` or `COUNCIL_MODEL_ORACLE` on the host and deploy, or change the default in `src/server/council/config.ts` and the label in `src/lib/agents.ts` and push.
3. Watch one session and check that the agent's lines are not tagged `scripted`.

The Executor's model must be an evaluation model such as Jev. A model that writes text will not answer its questions.


#### Raise the gateway's budget

In Vercel, open AI Gateway, then Budgets, and raise the limit on the key. The desk tries the models again within a quarter of an hour. Nothing has to be deployed.

#### Change how often sessions run

Set `COUNCIL_INTERVAL_SECONDS` (never less than 60) and `COUNCIL_MAX_ROUNDS_PER_DAY` on the host and deploy.

#### Change the admin's password

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

Set the three `ADMIN_` values from the file on the host and deploy. Every browser is signed out, the Pi included, and must sign in again.

#### Top up the treasury

| It needs | For | How |
| --- | --- | --- |
| ETH | Network fees | Send ETH on Robinhood Chain to the treasury's address. On the testnet, use a faucet |
| USDG | The agents' gains, withdrawals, bonuses, rewards | On the testnet the treasury can mint test USDG. On mainnet, send it USDG |

The treasury's address and balances are on the admin's display.

#### Take the desk's money out

```bash
node --env-file=.env.local scripts/cash-out.mjs --dry-run
node --env-file=.env.local scripts/cash-out.mjs --to 0x<your wallet>
```

Run it with the settings of the network the money is on. The first line sends nothing and says what each step would move. The second does it:

1. It takes back each contract's leave to draw USDG from the treasury, so a server that is still running can't put the money in again.
2. On each desk it closes every position at what it cost, and releases the agent's cash to the treasury.
3. It sends the treasury's USDG to the wallet named. Without `--to` the USDG stays in the treasury. `--keep 20` leaves that much there.

| Know this | |
| --- | --- |
| Stop the server first if you can | It signs with the same key. Two signers can take each other's place in the treasury's queue. The script tries each step again if that happens |
| The books are not touched | They still show the agents' money and positions. A server left running can move nothing, and logs that it can't fund the desks |
| What comes out | Everything that went in. Gains and losses were only ever settled between the desks and the treasury. With users' funding on, part of it is owed to the funders, and this script is not the way to pay them |
| To trade again | Send the USDG back to the treasury, run `scripts/deploy-desks.mjs` to give the contracts their leave again, and start the server on new books |

#### Replace the desk contracts

See [Contracts](#replacing-the-contracts). Close the old ones last.

#### Change what is on the board

Set the `BOARD_` settings on the host and deploy. See [Configuration](#the-board).

#### Put the display on a Raspberry Pi

See [Deployment](#the-raspberry-pi).

### When something stops

#### The agents are scripted

| The display says | Why | What to do |
| --- | --- | --- |
| no key set | `AI_GATEWAY_API_KEY` is missing on the host | Set it and deploy |
| budget used up | The key's budget in Vercel is spent | Raise it in Vercel, under AI Gateway, Budgets |
| the day's limit is reached | `COUNCIL_MAX_ROUNDS_PER_DAY` sessions ran today | Wait for the next UTC day, or raise the limit |
| did not answer the last session | The models failed or timed out | Look at the server's logs for the gateway's answer |

Only some lines tagged `scripted`, from one agent: that agent's model is failing. Check that the model's name is still listed by the gateway.

**After the server restarts it does not yet know that the budget is used up.** The display can say the agents are on their models until the next session is refused.

#### No session starts

| Check | |
| --- | --- |
| Is a page open? | Sessions start only while a page is open |
| Was the server asleep? | On the free plan the first visit after a sleep takes about a minute |
| Does the floor say "No market data available"? | See the next section |
| Do the logs show an error? | The session's failure is written there |

#### Prices or the board are missing

The market data comes from free public services, which refuse a server that asks too often.

- Wait a few minutes. Answers are kept and requests are paced, so it recovers by itself.
- If the board has fewer than eight tokens, fewer tokens cleared the limits. Lower `BOARD_MIN_VOLUME_USD` or `BOARD_MIN_LIQUIDITY_USD` if that lasts.
- If the chain's public endpoint is the one refusing, set `ROBINHOOD_MAINNET_RPC_URL` to an endpoint of your own.

#### A trade has no transaction

A trade shows "recording…" until its transactions land, which takes seconds. If it stays:

| Check | |
| --- | --- |
| The treasury's gas | Without ETH nothing can be sent |
| The treasury's USDG and its allowance to the contracts | A gain is paid in from the treasury |
| The chain | The explorer shows whether the network is up |

The desk tries four times and then marks the trade "not recorded". The books are right either way: the database is where they are kept.

#### A contract holds less than it owes

This should not happen. It means USDG left a contract outside the desk's own calls, or a settlement failed half way. Stop funding, read the contract's transactions on the explorer, and compare `owed()` with its USDG balance.

#### A deposit was sent but not credited

The funder can press confirm again with the same transaction: a transfer that was not confirmed yet is credited once it is. A transaction can be used for one deposit only.

#### A withdrawal did not arrive

The payment is recorded before it is sent. If it never lands, the shares are put back. The funder's list of events on `/fund` shows its state.

#### The admin can't sign in

| What you see | Why |
| --- | --- |
| "No admin account is set up on this server" | One of the three `ADMIN_` settings is missing, or the secret is shorter than 32 characters |
| "Too many wrong guesses" | Five wrong guesses from this address. Wait a quarter of an hour |
| "Wrong username or password" | The username is case-sensitive, and so is the password. The dashes are part of it |
| Signed out after a deploy | `ADMIN_SESSION_SECRET` or `ADMIN_USERNAME` was changed |

#### The Pi shows the sign-in page

Its cookie is gone: the browser was started in incognito mode, its data was cleared, or the secret was changed. Sign in again with a keyboard.

### Things not to do

- **Do not reset the database.** It holds the live desk's books and every funder's shares.
- **Do not run a second server on the live treasury.** Stop a local server before using the hosted one.
- **Do not close old contracts before the server runs with the new ones.** It would put the money back.
- **Do not commit secrets.** The repository is public.

---

## 14. Security and limits

### The secrets

| Secret | What someone who has it can do | Where it lives |
| --- | --- | --- |
| `TREASURY_PRIVATE_KEY` | Take everything the treasury holds, and operate the desk contracts | The host's environment, and `.env.local` |
| `DATABASE_URL` | Read and change the books and every funder's shares | The same |
| `AI_GATEWAY_API_KEY` | Spend the gateway's budget | The same |
| `CLAIM_SECRET` | Forge the messages wallets are asked to sign | The same |
| `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` | With the secret, sign a cookie and open the admin's display | The same |
| `TURNSTILE_SECRET_KEY` | Pass the captcha | The same |

Rules for all of them:

- **The repository is public.** Secrets go in `.env.local` and the host's environment, never in a committed file. `.env.local` and `.data/` are ignored by git.
- **Never put a secret in a setting that starts with `NEXT_PUBLIC_`.** The browser can read those.
- **A secret that was pasted anywhere, such as a chat or a ticket, is exposed.** Replace it.
- **Keep only a day's budget in the treasury.** It is a hot wallet: its key is on a server.
- **Use a treasury that holds nothing else.**

#### Replacing a secret

| Secret | How |
| --- | --- |
| Gateway key | Make a new key in Vercel, set it on the host, deploy, delete the old one |
| Database password | Reset it in Neon, set the new connection string on the host, deploy |
| Admin password | `node scripts/admin-password.mjs`, set the three values, deploy |
| Treasury | Make a new wallet, hand the contracts to it with `setOwner`, `setOperator` and `setTreasury`, move the funds, set the new key on the host, deploy |

### The admin's sign-in

| Protection | How |
| --- | --- |
| The password is not stored | The server keeps a scrypt hash of it, with a salt |
| Guessing is slow | Five wrong guesses lock an address out for a quarter of an hour, forty from everywhere lock everyone out, and a wrong guess is answered no sooner than 0.6 seconds |
| The answer's timing says nothing | The password is checked even when the username is wrong |
| The cookie can't be forged | It is signed with `ADMIN_SESSION_SECRET` |
| The cookie can't be read by page scripts | It is `HttpOnly`, and sent over HTTPS only |
| The page is checked on the server | Both the page and its data route check the cookie. A browser that is not signed in gets neither |
| Search engines are asked not to list it | The pages carry `noindex` |

What it does not have: a second factor, more than one account, or a record of sign-ins.

The display shows nothing that can move money. It has no controls.

### How money is protected

| Protection | How |
| --- | --- |
| Only the wallet's owner can withdraw | A withdrawal needs the wallet's signature of a message that names the agent and the share, and that expires |
| A deposit is checked on the chain | Sent by this wallet, to the treasury, in the right token, for the exact amount, after the request, and not used before |
| A payment is not made twice | It is recorded before it is sent, and its fate is asked of the chain before anything is retried |
| The contracts refuse strangers | Only the operator can fund an agent or record a trade |
| A contract can't be drained by a trade | It refuses a trade whose amount is more than two cents from the price times the quantity, and one it already holds |
| Rewards are bounded | One per wallet, a daily cap, a cap per IP address, a minimum history on mainnet, an optional captcha |
| Bonuses are bounded | One per wallet, a lock of seven days, a daily budget |

### What the platform does not do

These are the limits to know before relying on it.

| Limit | What it means |
| --- | --- |
| **No order goes to a market** | Trades are settled against the treasury at live prices. Swapping on a market, for example through Uniswap on Robinhood Chain, is not built |
| **The treasury is the counterparty** | An agent's gain is the treasury's loss. With real money, a good run by the agents costs the treasury real USDG |
| **The contracts are not audited** | They trust the operator's prices. A version for real money would read prices from the chain |
| **The price is the quoted price** | A trade is filled at the pool's quoted price, however little of the token a real order could buy there. Real orders in young tokens would move the price |
| **Nothing runs without an open page** | Sessions and the checks between them are started by an open page. A stop that was passed while no page was open is acted on later, at the price the token has then |
| **Funding is for the testnet** | It refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true` |
| **Market data comes from free public services** | If one is unreachable, a token drops off the board, a request waits, or a chart does not load |
| **Market holidays are not accounted for** | On a holiday the desk treats Stock Tokens as open, and sees prices that do not move |
| **The per-IP limits trust `x-forwarded-for`** | The server must sit behind a proxy you control |
| **There are no automated tests in the repository** | Except the contracts' tests. The checks used during development live outside version control |

### Before real money

- The agents must trade on a market first, or the treasury stays the counterparty to their results.
- The contracts must be audited.
- Holding users' funds and paying bonuses has legal, licensing and tax consequences in most countries. Get advice.
- Keep the treasury key in a secrets manager, and hand the contracts to a key that was never shared.

### What the site may and may not say

- Funding gives an agent more capital and more thinking time. It does not make results better or safer. The site must never promise a profit.
- A trade is settled at live prices against the treasury. The site must never describe it as an order placed on a market.
- Nothing on the site is financial advice.
