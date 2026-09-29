# 10. API reference

[Back to the index](README.md)

Every route is served by the same Next.js app, under `/api`. They take and return JSON. No route needs a key. Routes that move money need a signature from the wallet concerned, and the admin's route needs the admin's sign-in.

## How answers are shaped

| Kind of route | When it works | When it doesn't |
| --- | --- | --- |
| Reading | `200` with the data | `400` for a bad request, `502` when an outside service can't be reached, each with `{ "error": "..." }` |
| Funding and rewards | `200` with `{ "ok": true, ... }` | `400` and up with `{ "ok": false, "error": "..." }` |

The `error` is a sentence meant for the person using the page.

Nothing that is read is cached: the reading routes send `cache-control: no-store`.

## All routes

| Route | Purpose |
| --- | --- |
| [`GET /api/health`](#health) | Says the server is up |
| [`GET /api/council/state`](#the-desk-as-it-stands) | The desk as it stands now |
| [`POST /api/council/round`](#the-session-to-watch) | The session to watch, streamed stage by stage, or how long to wait |
| [`GET /api/council/round?round=N`](#a-finished-session) | The record of a finished session |
| [`GET /api/council/history`](#past-sessions) | Past sessions, newest first |
| [`GET /api/market/quotes`](#quotes) | Live quotes for the board and for what the desk holds |
| [`GET /api/market/candles`](#candles) | Candles for a token |
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

## The council

### Health

`GET /api/health`

Returns `{ "ok": true }`. The host asks it to decide whether a deploy is healthy. It touches nothing else.

### The desk as it stands

`GET /api/council/state`

Reading it also runs the checks between sessions: stops, targets and falling prices. See [Rules and risk](06-rules-and-risk.md#between-sessions).

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

### The session to watch

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

### A finished session

`GET /api/council/round?round=56`

Returns `{ "stages": [...] }`, the same stages as above. `404` if that session is not on record.

### Past sessions

`GET /api/council/history?before=56&limit=6`

| Parameter | Default | What it is |
| --- | --- | --- |
| `before` | the latest | Sessions earlier than this number |
| `limit` | 6 | How many. At most 12 |

Returns `{ "sessions": [{ "round": 55, "stages": [...] }, ...], "more": true }`, newest first. `more` says whether there are older ones.

---

## Market

### Quotes

`GET /api/market/quotes`

Returns `{ "quotes": { "ROO": { "price": ..., "change24h": ..., "change1h": ..., "change5m": ... }, ... } }` for the tokens on the board and the tokens the desk holds. `502` when no market data can be reached.

### Candles

`GET /api/market/candles?token=ROO&interval=5m`

| Parameter | What it is |
| --- | --- |
| `token` | A token on the board, one the desk holds, or one a funder asked for |
| `interval` | `1m`, `5m`, `15m` or `1h` |

Returns `{ "candles": [...] }`, up to 300 of them. `400` for an unknown token or interval.

### Look up a token

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

## Funding

### Funding status

`GET /api/fund/status?wallet=0x...`

`wallet` is optional.

| Field | What it is |
| --- | --- |
| `chain` | The network, the funding token's name, whether funding is `enabled` and the `reason` if not, whether the `faucet` is on |
| `terms` | Deposit limits, bonus tiers, fee, lock, commitment threshold |
| `agents` | For each agent: value per share, return, users' funding, free cash, analysis level |
| `wallet` | For the wallet given: its balance, its positions, its bonus, its deposits and withdrawals, its requests. `null` without a wallet |

### Deposit

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

### Withdraw

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

### Faucet

`POST /api/fund/faucet` with `{ "wallet": "0x..." }`

Testnet only. Returns the transaction and the amount sent.

---

## Rewards

### Rewards status

`GET /api/rewards/status?wallet=0x...`

| Field | What it is |
| --- | --- |
| `mode` | `live`, or `demo` when no treasury is configured |
| `amount` | USDG per claim |
| `remainingToday` | Claims left today |
| `captchaSiteKey` | Set when the captcha is on |
| `problem` | Why rewards can't be paid right now, or `null` |
| `claim` | This wallet's claim, or `null` |

### Reward challenge

`POST /api/rewards/challenge` with `{ "wallet": "0x...", "agent": "quant" }`

Returns a `message` to sign and a `token`.

### Reward claim

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

## Admin

### Admin status

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
