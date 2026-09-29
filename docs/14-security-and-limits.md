# 14. Security and limits

[Back to the index](README.md)

## The secrets

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

### Replacing a secret

| Secret | How |
| --- | --- |
| Gateway key | Make a new key in Vercel, set it on the host, deploy, delete the old one |
| Database password | Reset it in Neon, set the new connection string on the host, deploy |
| Admin password | `node scripts/admin-password.mjs`, set the three values, deploy |
| Treasury | Make a new wallet, hand the contracts to it with `setOwner`, `setOperator` and `setTreasury`, move the funds, set the new key on the host, deploy |

## The admin's sign-in

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

## How money is protected

| Protection | How |
| --- | --- |
| Only the wallet's owner can withdraw | A withdrawal needs the wallet's signature of a message that names the agent and the share, and that expires |
| A deposit is checked on the chain | Sent by this wallet, to the treasury, in the right token, for the exact amount, after the request, and not used before |
| A payment is not made twice | It is recorded before it is sent, and its fate is asked of the chain before anything is retried |
| The contracts refuse strangers | Only the operator can fund an agent or record a trade |
| A contract can't be drained by a trade | It refuses a trade whose amount is more than two cents from the price times the quantity, and one it already holds |
| Rewards are bounded | One per wallet, a daily cap, a cap per IP address, a minimum history on mainnet, an optional captcha |
| Bonuses are bounded | One per wallet, a lock of seven days, a daily budget |

## What the platform does not do

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

## Before real money

- The agents must trade on a market first, or the treasury stays the counterparty to their results.
- The contracts must be audited.
- Holding users' funds and paying bonuses has legal, licensing and tax consequences in most countries. Get advice.
- Keep the treasury key in a secrets manager, and hand the contracts to a key that was never shared.

## What the site may and may not say

- Funding gives an agent more capital and more thinking time. It does not make results better or safer. The site must never promise a profit.
- A trade is settled at live prices against the treasury. The site must never describe it as an order placed on a market.
- Nothing on the site is financial advice.
