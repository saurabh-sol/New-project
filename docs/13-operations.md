# 13. Operations

[Back to the index](README.md)

How to run the desk day to day: what to look at, how to do the common tasks, and what to do when something stops.

## Where to look

| To see | Look at |
| --- | --- |
| Everything at once | The admin's display, `/admin`. Its `system` pane turns a line red when something needs attention |
| Whether the agents are on their models | The header's badge on the front page |
| An agent's money on-chain | Its contract on the explorer, linked from its card |
| The server's own messages | The service's **Logs** on Render |
| What the models cost | Vercel, under AI Gateway |
| The database | Neon's console |

## A daily check

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

## What it costs

| | |
| --- | --- |
| One session | About 12 model calls, roughly $0.10 to $0.20 |
| An hour with a page open, at the default interval | 12 sessions, about $1 to $2.50 |
| A day at the default limit of 100 sessions | About $10 to $20 at most |
| Funded agents | Think harder, which costs more per session |
| Gas | A fraction of a cent per transaction on Robinhood Chain |
| Market data | Free |

One session is produced per interval no matter how many people are watching. Two settings bound the spend: `COUNCIL_MAX_ROUNDS_PER_DAY` and the budget set on the gateway key in Vercel.

## Common tasks

### Change an agent's model

1. Find the model's name at <https://ai-gateway.vercel.sh/v1/models>.
2. Either set `COUNCIL_MODEL_QUANT`, `COUNCIL_MODEL_GUARDIAN`, `COUNCIL_MODEL_DEGEN` or `COUNCIL_MODEL_ORACLE` on the host and deploy, or change the default in `src/server/council/config.ts` and the label in `src/lib/agents.ts` and push.
3. Watch one session and check that the agent's lines are not tagged `scripted`.

The Executor's model must be an evaluation model such as Jev. A model that writes text will not answer its questions.

### Raise the gateway's budget

In Vercel, open AI Gateway, then Budgets, and raise the limit on the key. The desk tries the models again within a quarter of an hour. Nothing has to be deployed.

### Change how often sessions run

Set `COUNCIL_INTERVAL_SECONDS` (never less than 60) and `COUNCIL_MAX_ROUNDS_PER_DAY` on the host and deploy.

### Change the admin's password

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

Set the three `ADMIN_` values from the file on the host and deploy. Every browser is signed out, the Pi included, and must sign in again.

### Top up the treasury

| It needs | For | How |
| --- | --- | --- |
| ETH | Network fees | Send ETH on Robinhood Chain to the treasury's address. On the testnet, use a faucet |
| USDG | The agents' gains, withdrawals, bonuses, rewards | On the testnet the treasury can mint test USDG. On mainnet, send it USDG |

The treasury's address and balances are on the admin's display.

### Replace the desk contracts

See [Contracts](07-contracts.md#replacing-the-contracts). Close the old ones last.

### Change what is on the board

Set the `BOARD_` settings on the host and deploy. See [Configuration](03-configuration.md#the-board).

### Put the display on a Raspberry Pi

See [Deployment](12-deployment.md#the-raspberry-pi).

## When something stops

### The agents are scripted

| The display says | Why | What to do |
| --- | --- | --- |
| no key set | `AI_GATEWAY_API_KEY` is missing on the host | Set it and deploy |
| budget used up | The key's budget in Vercel is spent | Raise it in Vercel, under AI Gateway, Budgets |
| the day's limit is reached | `COUNCIL_MAX_ROUNDS_PER_DAY` sessions ran today | Wait for the next UTC day, or raise the limit |
| did not answer the last session | The models failed or timed out | Look at the server's logs for the gateway's answer |

Only some lines tagged `scripted`, from one agent: that agent's model is failing. Check that the model's name is still listed by the gateway.

**After the server restarts it does not yet know that the budget is used up.** The display can say the agents are on their models until the next session is refused.

### No session starts

| Check | |
| --- | --- |
| Is a page open? | Sessions start only while a page is open |
| Was the server asleep? | On the free plan the first visit after a sleep takes about a minute |
| Does the floor say "No market data available"? | See the next section |
| Do the logs show an error? | The session's failure is written there |

### Prices or the board are missing

The market data comes from free public services, which refuse a server that asks too often.

- Wait a few minutes. Answers are kept and requests are paced, so it recovers by itself.
- If the board has fewer than eight tokens, fewer tokens cleared the limits. Lower `BOARD_MIN_VOLUME_USD` or `BOARD_MIN_LIQUIDITY_USD` if that lasts.
- If the chain's public endpoint is the one refusing, set `ROBINHOOD_MAINNET_RPC_URL` to an endpoint of your own.

### A trade has no transaction

A trade shows "recording…" until its transactions land, which takes seconds. If it stays:

| Check | |
| --- | --- |
| The treasury's gas | Without ETH nothing can be sent |
| The treasury's USDG and its allowance to the contracts | A gain is paid in from the treasury |
| The chain | The explorer shows whether the network is up |

The desk tries four times and then marks the trade "not recorded". The books are right either way: the database is where they are kept.

### A contract holds less than it owes

This should not happen. It means USDG left a contract outside the desk's own calls, or a settlement failed half way. Stop funding, read the contract's transactions on the explorer, and compare `owed()` with its USDG balance.

### A deposit was sent but not credited

The funder can press confirm again with the same transaction: a transfer that was not confirmed yet is credited once it is. A transaction can be used for one deposit only.

### A withdrawal did not arrive

The payment is recorded before it is sent. If it never lands, the shares are put back. The funder's list of events on `/fund` shows its state.

### The admin can't sign in

| What you see | Why |
| --- | --- |
| "No admin account is set up on this server" | One of the three `ADMIN_` settings is missing, or the secret is shorter than 32 characters |
| "Too many wrong guesses" | Five wrong guesses from this address. Wait a quarter of an hour |
| "Wrong username or password" | The username is case-sensitive, and so is the password. The dashes are part of it |
| Signed out after a deploy | `ADMIN_SESSION_SECRET` or `ADMIN_USERNAME` was changed |

### The Pi shows the sign-in page

Its cookie is gone: the browser was started in incognito mode, its data was cleared, or the secret was changed. Sign in again with a keyboard.

## Things not to do

- **Do not reset the database.** It holds the live desk's books and every funder's shares.
- **Do not run a second server on the live treasury.** Stop a local server before using the hosted one.
- **Do not close old contracts before the server runs with the new ones.** It would put the money back.
- **Do not commit secrets.** The repository is public.
