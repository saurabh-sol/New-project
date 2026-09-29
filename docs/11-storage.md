# 11. Storage

[Back to the index](README.md)

Storage is Postgres on [Neon](https://neon.tech). Tables are created the first time they are used (`src/server/db.ts`). The connection string stays on the server and never reaches browser code.

## The tables

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

## What the books keep

The books are one document (`CouncilState` in `src/server/council/store.ts`).

| Part | What it is | How much is kept |
| --- | --- | --- |
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

## How the money records are protected

| Safeguard | What it prevents |
| --- | --- |
| The books carry a version number. A change is saved only if the version is still the one that was read | Two servers overwriting each other |
| A session is claimed by saving the books. The save succeeds for one server only | Two sessions at once |
| Shares and the agent's books are written in one database statement | A deposit credited to the funder but not to the agent, or the other way round |
| Every payout records its transaction before it is sent | A crash paying twice |
| A deposit's transaction can be used once | One transfer credited twice |
| Each contract keeps the id of every trade on it | A trade recorded twice on-chain |

## Without a database

The desk's state is kept in a local file, `.data/council.json`, and sessions are kept in memory. Funding and rewards are off. This is for running the floor on your own computer.

## The database is the live desk's

A server started with the hosted site's `DATABASE_URL` reads and writes the live books, and applies stops and falling exits to them. For development, use a database of your own or none.

## Backups

Neon keeps a history of the database that a point in time can be restored from. How far back depends on the plan. Nothing in the app makes backups of its own.
