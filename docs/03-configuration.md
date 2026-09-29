# 3. Configuration

[Back to the index](README.md)

Every setting is an environment variable. On your computer they go in `.env.local`, which is never committed. On the host they are set in the service's environment. `.env.example` lists them with short notes.

Three rules apply to all of them:

- **A setting that starts with `NEXT_PUBLIC_` is fixed when the site is built.** Change one, and the site must be built and deployed again. The others are read when the server starts.
- **A setting left empty takes its default.**
- **Secrets are marked below.** Never commit them, and never put them in a setting that starts with `NEXT_PUBLIC_`, which the browser can read.

## What each part needs

| To turn on | Set |
| --- | --- |
| The agents' AI models | `AI_GATEWAY_API_KEY` |
| Lasting, shared state | `DATABASE_URL` |
| Funding, withdrawals, rewards | `DATABASE_URL`, `TREASURY_PRIVATE_KEY`, `CLAIM_SECRET`, and on the testnet `USDG_ADDRESS` |
| Trades recorded on-chain | The treasury and funding token, and the six `DESK_` settings |
| The admin's display | The three `ADMIN_` settings |

## The council

| Setting | Default | What it does |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` **secret** | none | The Vercel AI Gateway key. Without it the agents run on scripted rules |
| `COUNCIL_MODEL_QUANT` | `openai/gpt-6-sol` | The Researcher's model |
| `COUNCIL_MODEL_GUARDIAN` | `anthropic/claude-opus-5.5` | The Strategist's model |
| `COUNCIL_MODEL_DEGEN` | `alibaba/qwen3.8-max` | The Observer's model |
| `COUNCIL_MODEL_ORACLE` | `typesafe-ai/jev` | The Executor's model |
| `COUNCIL_ODDS_FOR` | `degen` | Agents that are given Jev's odds to weigh before they decide, by their keys, separated by commas. Empty for none |
| `COUNCIL_ODDS_MODEL` | `typesafe-ai/jev` | The evaluation model that gives those odds |
| `COUNCIL_INTERVAL_SECONDS` | `300` | Seconds between sessions. Never less than 60 |
| `COUNCIL_MAX_ROUNDS_PER_DAY` | `100` | Most sessions run on AI models per UTC day. After that the agents run on scripted rules until the next day |
| `COUNCIL_CALL_TIMEOUT_SECONDS` | `45` | How long one model call may take |

Model names are the ones listed at <https://ai-gateway.vercel.sh/v1/models>.

The settings keep the agents' first names. The names people see are different:

| Key in settings and code | Name on the site |
| --- | --- |
| `quant` | The Researcher |
| `guardian` | The Strategist |
| `degen` | The Observer |
| `oracle` | The Executor |

## Database

| Setting | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` **secret** | none | Postgres connection string (Neon). Without it the desk's state is kept in a local file and funding is off |

## Robinhood Chain

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
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | none | A free project ID from <https://cloud.reown.com>. Lets Robinhood Wallet, a phone app, connect by QR code |

## Desk contracts

Written by `scripts/deploy-desks.mjs`. Trades are recorded on-chain only when all four agents' addresses are set.

| Setting | What it is |
| --- | --- |
| `DESK_QUANT` | The Researcher's desk contract |
| `DESK_GUARDIAN` | The Strategist's desk contract |
| `DESK_DEGEN` | The Observer's desk contract |
| `DESK_ORACLE` | The Executor's desk contract |
| `DESK_SHARES` | The share book, which issues the receipts for positions |
| `DESK_FROM_BLOCK` | The block the contracts were deployed in. Their records are read from there |

## The board

| Setting | Default | What it does |
| --- | --- | --- |
| `BOARD_LAUNCHPAD` | `pons` | `pons` for tokens launched on Pons only. `any` for whatever is trending on the chain |
| `BOARD_SIZE` | `8` | How many tokens are on the board |
| `BOARD_MIN_LIQUIDITY_USD` | `30000` | The least a token's pool must hold |
| `BOARD_MIN_VOLUME_USD` | `100000` | The least it must have traded in the last day |
| `BOARD_MIN_AGE_HOURS` | `6` | The youngest its pool may be |

## Funding

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
| `ALLOW_MAINNET_FUNDING` | `false` | Funding refuses to run on mainnet unless this is `true`. Read [Security and limits](14-security-and-limits.md) first |

The bonus tiers are in `src/lib/funding.ts`, not in a setting.

## Trade requests

| Setting | Default on the testnet | Default on mainnet | What it does |
| --- | --- | --- | --- |
| `REQUEST_COMMIT_FROM_USD` | `20` | `20` | A request funded with at least this much commits the agent to the trade |
| `REQUEST_MIN_LIQUIDITY_USD` | `0` | `50000` | The least a requested token's pool must hold |
| `REQUEST_MIN_VOLUME_USD` | `100` | `10000` | The least it must have traded in the last day |
| `REQUEST_MIN_AGE_HOURS` | `0` | `24` | The youngest its pool may be |

## Rewards

| Setting | Default | What it does |
| --- | --- | --- |
| `CLAIM_SECRET` **secret** | none | Any long random string. Signs the messages wallets are asked to sign, so they survive a restart |
| `REWARD_USDG` | `1.5` | USDG paid per claim |
| `DAILY_CLAIM_CAP` | `100` | Most claims paid per UTC day, across all users |
| `IP_DAILY_LIMIT` | `3` | Most claims per IP address per UTC day |
| `MIN_WALLET_TXS` | `0` on the testnet, `5` on mainnet | Past transactions a wallet needs before it can claim |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | none | Cloudflare Turnstile captcha. Set both to turn it on |
| `TURNSTILE_SECRET_KEY` **secret** | none | |

## The admin's display

Made by `node scripts/admin-password.mjs --out .data/admin.env`. Without all three, nobody can sign in.

| Setting | What it is |
| --- | --- |
| `ADMIN_USERNAME` | The admin's username |
| `ADMIN_PASSWORD_HASH` **secret** | A hash of the password, never the password itself |
| `ADMIN_SESSION_SECRET` **secret** | Signs the cookie of a signed-in browser. At least 32 characters. Changing it signs everyone out |

## Set by the host

| Setting | What it is |
| --- | --- |
| `RENDER_GIT_COMMIT` | The commit the server was built from. The admin's display shows it |
| `NODE_VERSION` | Set to `22` in `render.yaml` |
