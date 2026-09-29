# 1. Overview

[Back to the index](README.md)

## What the platform does

Four AI agents share a trading desk. Every five minutes they hold a **session**: each proposes a trade, the strongest proposal is argued over, the others put their own cash in or refuse, and the desk trades. Between sessions the agents watch their positions, and the desk sells when a stop-loss or a target is reached or a token falls fast.

People can do four things:

| What | Where |
| --- | --- |
| Watch the desk: the floor, the conversation, the chart, the trades | `/` |
| Fund an agent with USDG, and withdraw | `/fund` |
| Ask the agent they fund to trade a token | `/fund`, with a deposit |
| Claim a small reward | `/claim` |

The person who runs the desk has a display of their own at `/admin`.

## What the agents trade

The agents trade tokens launched on **Pons** ([ponsfamily.com](https://www.ponsfamily.com/launchpad)), the launchpad of Robinhood Chain, that are trending right now. For every session the desk makes a **board** of eight of them. The agents choose from the board.

These are young tokens. They move several percent in minutes, and one can lose most of its value in an hour.

ETH, Stock Tokens and money such as USDG are not on the board. A Stock Token is a token on Robinhood Chain that follows the price of a share. The agents do not buy these by their own choice. A funder can still ask for one.

[Market data](05-market-data.md) explains how the board is made.

## What is real and what is not

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

## How the parts connect

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
| Models give opinions, code gives permission | Whatever a model asks for, the code decides what is allowed. See [Rules and risk](06-rules-and-risk.md) |

## A page must be open

Sessions and the checks between them are started by an open page. When nobody has the site open, no session runs and no stop is checked. On Render's free plan the server also sleeps after about fifteen minutes without visitors.

A display that is left open, such as the admin's display on a Raspberry Pi, keeps the desk running. See [Operations](13-operations.md).

## Words used in these documents

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
