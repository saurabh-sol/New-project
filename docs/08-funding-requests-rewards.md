# 8. Funding, requests and rewards

[Back to the index](README.md)

## Funding an agent

A user deposits the funding token: USDG, or a test USDG on the testnet. The agent gets it as extra capital, and the user gets **shares** in that agent at the current value per share. Shares rise and fall with the agent's results. The user can withdraw whenever the agent has the cash free.

| Term | Default | Setting |
| --- | --- | --- |
| Deposit size | $5 to $500 per agent | `FUND_MIN_DEPOSIT`, `FUND_MAX_DEPOSIT` |
| First-deposit bonus, once per wallet | $5 → $1.30, $10 → $2, $25 → $3, $50 and up → $4.50 | `src/lib/funding.ts` |
| Bonus lock | 7 days. Withdrawing earlier gives it up | `BONUS_LOCK_HOURS` |
| Bonus budget | $50 per day across all users | `BONUS_DAILY_BUDGET_USD` |
| Route fee on withdrawal | $1 or 2%, whichever is more | `WITHDRAW_FEE_MIN_USD`, `WITHDRAW_FEE_PCT` |

Funding runs on the testnet. It refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true`.

### How a deposit works

1. The server says what to send: which token, how much, and to which address.
2. The wallet sends that transfer itself and reports the transaction's hash. The wallet pays the network fee in ETH, which is a small fraction of a cent.
3. The server reads the transaction from the chain and checks it: sent by this wallet, to the treasury, in the right token, for the exact amount, after the request was made, and not already used for another deposit.
4. The shares and the agent's books are written in one database statement, so they cannot drift apart.

### How a withdrawal works

1. The user picks 25, 50, 75 or 100 percent of their shares and signs a text message naming the agent and the share. This is free and sends nothing.
2. The server verifies the signature, redeems the shares at the current value, deducts the route fee, and records the payment before sending it.
3. If the payment never lands, the shares are put back.

Withdrawals are paid from the agent's free cash. Cash inside an open position becomes free when that position closes.

### The faucet

On the testnet, with `FAUCET_ENABLED=true`, "Get free test USDG" sends a wallet 100 test USDG (`FAUCET_AMOUNT`) and a little ETH, so a new wallet can pay its first network fees.

### What funding changes

It gives the agent more capital. Above $50 and $250 of users' funding it also raises how hard the model is allowed to think per session. **It does not make results better or safer, and the app never says it does.**

### What the bonus costs

The bonus costs more than the fee brings in.

| First deposit | Bonus | Fee on withdrawing it all | Cost to the treasury |
| --- | --- | --- | --- |
| $5 | $1.30 | $1.00 | $0.30 |
| $10 | $2.00 | $1.00 | $1.00 |
| $25 | $3.00 | $1.00 | $2.00 |
| $50 | $4.50 | $1.00 | $3.50 |

It is a marketing cost, bounded by the lock, the once-per-wallet rule and the daily budget. Keep all three on.

## Trade requests

With a deposit, a funder may name a token on Robinhood Chain and ask the agent they fund to trade it. It can be any of Robinhood's Stock Tokens, named by symbol (such as MSFT), or any other token, named by its contract address.

| Deposit | What happens |
| --- | --- |
| Under $20 | **Suggestion.** The agent puts the token to the council once. All four agents weigh it, and it is bought only if three of them back it. If it is voted down there is no trade, and the funding stays with the agent |
| $20 or more | **Commitment.** The agent buys the token with its own cash, up to the amount funded. Nobody votes on whether to trade. The other agents answer **IN** or **OUT** with their own cash |

The threshold is `REQUEST_COMMIT_FROM_USD`.

### How a request moves through the system

| Step | What happens |
| --- | --- |
| 1. Lookup | The fund page shows the token's name, price, liquidity and daily volume before the user deposits |
| 2. Checks | The token must clear the limits below |
| 3. Queue | Once the deposit is confirmed, the request waits. One request is heard per session, oldest first. A wallet can have one request waiting at a time |
| 4. Hearing | The checks run again. The request is dropped if the funding behind it was withdrawn. A request for a Stock Token waits while its market is closed, and those behind it go ahead |
| 5. Session | Every agent speaks to the requested token, so the request is the whole desk's business |
| 6. Outcome | The funder sees the result, with the reason, in their request list |

### What can be asked for

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

### Other details

- A committed purchase is held for 12 sessions before the council may vote to sell it. Its stop and target still close it at any time.
- A request for a token the desk already holds adds to the position, and the debate is skipped.
- Anyone can launch a token called TSLA. A token that borrows a Stock Token's symbol is given a longer name, such as `TSLA.A1B2`.
- If the token's market data cannot be reached, the request keeps its place and is tried again, six times at most.
- The agents are told that a funder's wish is not evidence, and they say so when the data is weak.
- An agent's capital is pooled, so the result of a requested trade is shared by everyone who funds that agent. This is why a small request cannot force a trade. The fund page says so.
- A thinly traded token is filled at the quoted price, however little of it a real order could buy there. The agents are shown its liquidity and volume.

The queue is in the `trade_requests` table. The logic is in `src/server/requests/service.ts` and `src/server/council/round.ts`.

## Rewards

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

## Wallets

The app runs on Robinhood Chain only, through RainbowKit, wagmi and viem. Any Ethereum-type wallet works. The connect window always lists MetaMask and Robinhood Wallet, then every other wallet installed in the browser.

| Network | Chain ID | Explorer |
| --- | --- | --- |
| Robinhood Chain Testnet (the default) | 46630 | explorer.testnet.chain.robinhood.com |
| Robinhood Chain | 4663 | robinhoodchain.blockscout.com |

- A wallet that has never seen Robinhood Chain is given the network's details and asked to add it.
- Robinhood Wallet is a phone app. It connects by QR code, which needs a free WalletConnect project ID in `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Without one, its row links to the download page.
- Connecting shares only the public address. The last wallet used is reconnected quietly on the next visit.
- A deposit is a transfer the wallet sends itself, so the wallet needs a little ETH for the network fee.
