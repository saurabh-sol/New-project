# The Council

Four AI agents share a trading desk on [Robinhood Chain](https://docs.robinhood.com/chain). They read the same live market data, pitch trades, argue at each other's desks, commit their own cash, vote, and hold positions with stops and targets.

The desk trades tokens launched on Pons, the launchpad of Robinhood Chain, that are trending right now, and pays in USDG. For every session it makes a board of eight of them, each with a pool that holds at least $30,000, traded $100,000 in the last day and is six hours old (`BOARD_SIZE`, `BOARD_MIN_LIQUIDITY_USD`, `BOARD_MIN_VOLUME_USD`, `BOARD_MIN_AGE_HOURS`). ETH, Stock Tokens and money such as USDG are left off the board: the agents do not buy them. Those the desk still holds from before are listed so that they can be sold.

These are young tokens. They move several percent in minutes, and one can lose most of its value in an hour.

### Where the board's tokens come from

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

| Agent | Model | Role | Character colour |
| --- | --- | --- | --- |
| The Researcher | GPT-6 Astra speaks, Jev decides | Momentum, RSI, volume | White |
| The Strategist | Claude Opus 5.5 | Risk manager | Orange |
| The Observer | Qwen 3.8 Max speaks, Jev decides | Momentum specialist | Blue |
| The Executor | Jev | Probabilities and odds | Pink |

All four run through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

The full documentation is one document, [docs/final.md](docs/final.md): how the platform works, every setting, the contracts, the API, deployment and operations.

The site itself is black and white, and comes in a dark and a light theme: the button beside the wallet switches between them, and the choice is remembered. Colour is used only on the agents' characters, and green and red on gains and losses. The trading floor is a lit stage and stays dark in both themes.

On a wide screen the floor page fits on one screen: the agents and their positions on the left, the floor and the chart in the middle, the conversation and the latest trades on the right. The full order history is below. Both trade lists open on the sales that booked a gain, say how many of the closed trades that is, and show every order, losses included, under "All"; the agents' results and the desk's totals always count every trade.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev -- -p 3210
```

| Page | What it is |
| --- | --- |
| `/` | The trading floor, chart, agents, positions and order history |
| `/fund` | Fund an agent, and withdraw |
| `/claim` | Arena Rewards |
| `/kiosk` | Full-screen display for a wall screen or Raspberry Pi |
| `/admin` | The admin's display: the floor with the trades, positions and system state set as a terminal shows them. Needs a sign-in |

## What is real and what is not

| Part | Status |
| --- | --- |
| Prices | Real, and a few seconds old. A token's price is its trading pool's, as DexScreener reports it. The page asks for prices every five seconds |
| Candles, RSI, trend, volume, buys and sells | Real. Candles are made from the pool's own record of its swaps on Robinhood Chain, put in USD at the live price; GeckoTerminal stands in when the chain can't be read. The count of purchases and sales over five minutes is DexScreener's |
| What the agents say and decide | Real model output, when a gateway key is set |
| Trades and results | Settled at real prices, with the treasury as the other side. Nothing is bought or sold on a market. With the desk contracts deployed, each agent's part of every trade is recorded on the agent's own contract on Robinhood Chain and moves real USDG |
| Deposits, withdrawals, bonuses, rewards | Real USDG transfers on Robinhood Chain (the testnet by default) |

A line tagged `scripted` in the conversation was written by a rule-based stand-in, because that model could not be reached or no key is configured.

Because no order goes to a market while funding uses real tokens, **the treasury is the counterparty to the agents' results**: if an agent gains, withdrawals cost the treasury more than was deposited. That is fine for a testnet demo. Do not run funding with real money until the agents trade for real.

## The desk contracts

Every agent has a contract of its own on Robinhood Chain: `contracts/AgentDesk.sol`. They are optional: without them the desk works the same, and its trades are kept in the desk's books with no transaction to show.

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

What they are not: they do not swap tokens on a market. A trade is settled at the live price the server reports, and the contract has to trust that price. They have not been audited, and their deploy script refuses mainnet unless `ALLOW_MAINNET_FUNDING=true`.

The database is where the books are kept. After each trade, deposit and withdrawal the server makes the same change on-chain (`src/server/chains/desk.ts`). If the chain can't be reached, the change waits and is made later, so a contract can lag the books by a moment but never holds up a session or a payment.

Each agent holds the tokens its own money bought. An agent that joins a position late, at a higher price, gets fewer tokens for its money, and the agents who were in first keep their gain.

### Where the contracts are

| | Robinhood Chain testnet, which the site runs on | Robinhood Chain mainnet |
| --- | --- | --- |
| The Researcher's desk | `0x38b8f564aa603707580e091fa6f5b89ad11b6bc8` | `0xf543786e6f5793904245414aebc427c7ec090387` |
| The Observer's desk | `0x17c17353f7e2424a8560772b93c3d943c36f001e` | `0xf8a28d9ea736a2dfd4e425b17cfde845859b1675` |
| The Strategist's desk | `0x7fb674e69a48a8320b42c5d9c2ea0bb486f70bcb` | `0x5e9afd96d88d98b8efca96b57a5816854b1f61d9` |
| The Executor's desk | `0xf26d49310d513266f03967ace14b305154947348` | `0xc25d7c5980819a4da5286e75d9cd7393012862ae` |
| The share book | `0xf8f674caa3fed59528cf38ac7b294a8959ffdce9` | `0x57e2fd4848709acc6f43935cff028d0a4bc50102` |
| Treasury, which owns and operates them | `0xf7D07942E1F8633F54F9200CB3b54d05EE60dca2` | `0x883b885C8F70b733B1C134FF621B033697bAf1DF` |
| Explorer | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) | [robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com) |

Each desk carries its agent's name, which can be read from the contract. Their source is published on both explorers, and on [Sourcify](https://sourcify.dev) for mainnet, where it matches the deployed code exactly.

The mainnet contracts are deployed and hold nothing. The site does not use them: it runs on the testnet. They have not been audited, they do not swap on a market, and the treasury takes the other side of every trade, so with real USDG an agent's gain is the treasury's loss. Before the site is pointed at them, the treasury needs USDG for the agents' capital, and `scripts/deploy-desks.mjs` has to be run once more, without `--no-approve`, to let the contracts draw it.

Deploy them once the funding token is set up:

```bash
node --env-file=.env.local scripts/deploy-desks.mjs
```

It sets `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES` and `DESK_FROM_BLOCK`, and lets each contract draw USDG from the treasury. The server puts each agent's cash, and the positions it already holds, into its contract the first time it runs with them.

The agents used to share one contract, `CouncilDesk.sol`. It keeps its record of the trades made through it. `scripts/retire-desk.mjs` closes it and returns its USDG to the treasury.

## How a session runs

1. **Pitch.** Every agent gets the same market table and the desk's positions, plus a focus for this round, and proposes BUY, SELL or HOLD.
2. **Proposal.** The strongest non-HOLD pitch becomes the proposal. If everyone holds, the session ends with no trade.
3. **Debate.** Two agents walk to the leader's desk, one after the other. The leader answers and may tighten its terms.
4. **Pledge.** Each other agent either commits its own cash or refuses, and says why.
5. **Vote.** A vote is what the agent did with its money: cash in means YES, nothing in means NO. Three of four passes.
6. **Order.** The desk buys or sells at the live price.

### Every agent trades its own book

Each agent has $100 of the treasury's capital and is judged on its own result.

- **A pitch is a decision.** The strongest pitch is put to the council. An agent that pitched the same trade joins it with the cash it named. Every other agent trades the idea it pitched by itself, for its own book.
- **Without the council's backing the leader trades alone.** A vote that fails means there is no desk trade, not that there is no trade. The exception is a funder's suggestion, which is only bought if the council backs it.
- **An agent with nothing opens a position,** when the desk's entry rules let it buy a token. When they let nothing through, it holds its cash and says so.
- **The books are spread.** Agents opening a first position choose one after another, and each is told what the others took and picks something else.
- **Selling.** The tokens an agent holds are its own to sell, from the session after it bought them. Its sale leaves the other holders' tokens where they are. The council can also vote to sell a position for everyone who holds it.
- **Selling into a fall.** The agents are told to sell a token they hold when it is falling fast, and between sessions a rule does it for them. See below.
- One trade takes at most 60% of an agent's cash.

Between sessions the agents watch their positions. Stops and targets are checked against the live price.

### The trading skill

`skill.md` is how the agents are told to trade, and `src/server/council/playbook.ts` is what the desk enforces of it: a token is bought only below 60% of its daily range, with an RSI under 70 and sellers not leading; a purchase may cost an agent 1.5% of what it is worth if its stop is hit; a target stands twice as far away as the stop; and once a position is up by its stop's distance, the stop follows the price up and the trade can no longer lose. No rule makes every trade a gain. See [the documentation](docs/final.md#the-trading-skill).

### Rules the code enforces, whatever a model asks for

- An agent can never stake more than its cash, and no more than 60% of it in one trade of its own.
- The desk can only sell a token it holds, and only after holding it for 2 sessions.
- No token may exceed 40% of the pool. Orders under $10 are not placed.
- Every position has a stop-loss and a profit target.
- ETH and Stock Tokens are not bought. A Stock Token the desk still holds is neither bought nor sold while its market is closed.

### Between sessions

Whenever the desk's state is read, and that is every few seconds while a page is open, each position is checked against its live price (`src/server/council/risk.ts`):

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

A fall counts when more was sold than bought over those five minutes. Where too few trades were made to tell, the fall has to be half as deep again. A token that swings needs a larger fall: never less than half the distance to the position's stop. A position bought in the last three minutes is left alone, and so is one bought on a commitment to a funder, which its stop guards.

This is a rule, not a model's judgement: it has to act within seconds. In a session the models make the same call for themselves, from the same figures.

Nothing is checked while no page is open. A stop that was passed in that time is acted on at the next check, at the price the token has then.

### Keeping the agents from repeating themselves

A model can't be retrained from this app. What the app controls is what each agent is given (`src/server/council/skills.ts`):

- **A rotating focus.** Each agent has several analytical skills and is handed the one it has gone longest without using.
- **Its own recent lines**, with an instruction not to reuse their points or wording.
- **A repeat check.** A draft too close to something the agent already said is sent back once for a different point.

- **Memory of the token.** When a token comes up again, each agent is shown what it said the last time the desk debated it.
- **Stock remarks vary.** Jev and the scripted stand-in speak from templates. Each template has several wordings, and the one chosen is the least like what that agent said before and what anyone said this session.

### The conversation is kept, and shown to everyone

Every session is saved in the database. When anyone opens the site, on any device, the last six sessions' conversation is put on the page at once, and "Show earlier sessions" reads further back. Nothing depends on what that browser has seen before.

A session is played once per browser. Coming back to the trading floor shows it as history instead of playing it again, and after a refresh in the middle of a session the lines already watched are put back at once and the session carries on from there. The show runs above the pages, so moving from one page to another doesn't interrupt it. A first-time visitor sees the latest session as a replay, marked as one.

Lines are kept short, the way traders talk across a desk: the models are asked for at most 15 words, and anything over 120 characters is cut.

### About Jev

Jev is an evaluation model. It answers typed questions with probabilities and scores and writes no text. Every number The Executor speaks is Jev's answer; the sentence around it is a template in `src/server/council/jev-brain.ts`.

The Researcher and The Observer decide on Jev's odds too: what to trade, how much, and how to vote. Their own models, GPT-6 Astra and Qwen 3.8 Max, are handed each decision with the odds behind it and say it in the agent's words (`src/server/council/voice.ts`). They cannot change it, and a line that names a figure they were not given, or leaves out the odds, is replaced by the template's. `COUNCIL_BRAIN_QUANT` and `COUNCIL_BRAIN_DEGEN` set the model that decides; set one to the agent's own model to have that model decide again.

## Funding an agent

A user deposits tokens, which the agent gets as extra capital. The user holds shares in that agent, worth more or less as the agent's results move. They can withdraw whenever the agent has the cash free.

| Term | Default | Setting |
| --- | --- | --- |
| Deposit size | $5 to $500 per agent | `FUND_MIN_DEPOSIT`, `FUND_MAX_DEPOSIT` |
| First-deposit bonus, once per wallet | $5 → $1.30, $10 → $2, $25 → $3, $50+ → $4.50 | `src/lib/funding.ts` |
| Bonus lock | 7 days; withdrawing earlier forfeits it | `BONUS_LOCK_HOURS` |
| Bonus budget | $50 per day | `BONUS_DAILY_BUDGET_USD` |
| Route fee on withdrawal | $1 or 2%, whichever is more | `WITHDRAW_FEE_MIN_USD`, `WITHDRAW_FEE_PCT` |

**The bonus costs more than the fee brings in.** A first-time $5 funder who withdraws costs the treasury $0.30; a $50 funder costs $3.50. Treat it as a marketing cost, and keep the lock and the daily budget on.

**What funding changes.** It gives the agent more capital, and above $50 and $250 it raises how hard the model is allowed to think per session. It does not make results better or safer, and the app never says it does.

### Trade requests

With a deposit, a funder may name a token on Robinhood Chain and ask the agent they fund to trade it. A funder's request is the one way a Stock Token is still bought. It can be any of Robinhood's Stock Tokens by symbol (such as MSFT), or any other token by its contract address. How far that binds the agent depends on the size of the deposit:

| Deposit | What happens |
| --- | --- |
| Under $20 | **Suggestion.** The agent puts the token to the council once. All four agents weigh it, and it is bought only if 3 of them back it. |
| $20 or more | **Commitment.** The agent buys the token with its own cash, up to the amount funded. Nobody votes on whether to trade: the other agents answer IN or OUT with their own cash. |

The threshold is `REQUEST_COMMIT_FROM_USD`.

- One request is heard per session, oldest first. A wallet can have one request waiting at a time.
- Any token on Robinhood Chain can be asked for by its contract address, so long as it has a live price and enough history for the agents to read: it must have traded in the last day, and have about three hours of trading on record. Its price comes from its most liquid pool, as DexScreener reports it, or GeckoTerminal for a token DexScreener has no price for.
- With real money the desk keeps to established markets: on mainnet a pool token needs $50,000 of liquidity, $10,000 of daily volume and a day of age. `REQUEST_MIN_LIQUIDITY_USD`, `REQUEST_MIN_VOLUME_USD` and `REQUEST_MIN_AGE_HOURS` set these floors on either network. They are checked when the request is made and again when it is heard.
- A thinly traded token is a risk the agents are told about: they see its liquidity and volume, and a trade is filled at the quoted price however little of the token a real order could buy there.
- USDG itself can't be asked for. It is the money the desk trades with.
- Anyone can launch a token called TSLA. A token that borrows a Stock Token's symbol is given a longer name, such as `TSLA.A1B2`, so it can't be mistaken for the real one.
- A request for a Stock Token waits while its market is closed. Requests behind it in the queue go ahead.
- A request is dropped if the funding behind it was withdrawn before it was heard.
- If the token's market data can't be reached, the request keeps its place and is tried at a later session, six times at most.
- In a request session every agent speaks to the requested token, so the request is the desk's business and not one agent's.
- A suggestion that is voted down means no trade. The funding stays with the agent; $5 can't force a trade on capital that other funders share.
- A committed purchase is held for at least 12 sessions (`COMMITTED_HOLD_ROUNDS` in `src/lib/council.ts`) before the council may vote to sell it. Its stop-loss and target still close it at any time.
- A request for a token the desk already holds adds to the position. The agents are given what they said about the token before and are told to say only what has changed, and the debate is skipped.
- The trade is settled like every other, at the live price against the treasury, and has a stop-loss and a target.
- An agent's capital is pooled, so the result of a requested trade is shared by everyone who funds that agent. The fund page says so.

Stock Tokens are priced by Robinhood. Other tokens are priced by their pool: price and liquidity from DexScreener, candles from GeckoTerminal. None of these needs a key. The agents are told that a funder's wish is not evidence, and they say so when the data is weak.

### Stops

Whatever an agent asks for, the desk sets a purchase's stop-loss at least 1.5 times the token's usual 5-minute movement away (within the 3% to 25% range), and its target no nearer than the stop. A stop closer than that is set off by ordinary movement. The rule is `fitTerms` in `src/server/council/brain.ts`.

### Testnet setup

| Network | Chain ID | Funding token |
| --- | --- | --- |
| Robinhood Chain Testnet (the default) | 46630 | A test USDG that the setup script deploys |
| Robinhood Chain | 4663 | USDG, `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

1. Set `DATABASE_URL`, `TREASURY_PRIVATE_KEY` and `CLAIM_SECRET` in `.env.local`. The treasury is an ordinary Ethereum-type wallet.
2. Send the treasury's address some testnet ETH. Faucets: [Alchemy](https://www.alchemy.com/faucets/robinhood-testnet), [Chainstack](https://faucet.chainstack.com/robinhood-chain-testnet-faucet), [QuickNode](https://faucet.quicknode.com/robinhood/testnet).
3. Run `node --env-file=.env.local scripts/setup-testnet.mjs`. It deploys a test USDG the treasury can mint (`contracts/TestUSDG.sol`) and sets `USDG_ADDRESS`.
4. Restart the server. Users can now press "Get free test USDG" and fund an agent. The faucet also sends a little ETH, so a new wallet can pay its first network fees.

Funding refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true`.

## Arena Rewards (`/claim`)

The user connects a wallet, backs an agent and signs a free message. The server verifies the signature and sends tokens from the treasury, which also pays the network fee. One claim per wallet, with a daily cap, a per-IP cap, a minimum wallet history and an optional Cloudflare Turnstile captcha.

## Wallets

The app runs on Robinhood Chain only, through RainbowKit, wagmi and viem. Any Ethereum-type wallet works. The connect window always lists MetaMask and Robinhood Wallet, then every other wallet installed in the browser.

- A wallet that has never seen Robinhood Chain is given the network's details and asked to add it.
- Robinhood Wallet is a phone app. It connects by QR code through WalletConnect, which needs a free project ID from <https://cloud.reown.com> in `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. Without one, its row links to the download page.
- A deposit is a USDG transfer that the wallet sends itself, so the wallet needs a little ETH for the network fee.

## Showing it on a Raspberry Pi

Open `/kiosk` full screen. It fits one screen with no scrolling, hides the cursor, and switches off blur and glow effects that a Pi's graphics chip handles poorly.

The simplest setup is to run the server on another computer and point the Pi's browser at it:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=http://<server-address>:3210/kiosk
```

Turn off screen blanking in `raspi-config` so the display stays on. A Pi 4 or 5 with a 1080p screen is the target.

## The admin's display

`/admin` is one page for the person who runs the desk, made to be left on a Raspberry Pi's screen. Only the admin can open it.

| On the screen | What it shows |
| --- | --- |
| Top line | Session number and stage, time to the next session, pool equity and result, whether the agents are on their AI models, the clock |
| Prices | The tokens on the board and those held, running under the top line |
| The floor | The council, as on the front page |
| Agents | Each agent's model, what it is doing, its result, cash, money in trades, and its contract's balance |
| `trades.log` | Every trade, the newest written at the bottom: time, side, token, size, price, who led it, why, the result, and how many of the agents' contracts hold it |
| `positions` | What is held, the price against the stop and the target, who holds it and for how long |
| `system` | The gateway and today's sessions, the last session and risk check, the price feed, the contracts, the treasury's gas and USDG, the server's version and uptime. A line turns red when something needs attention |

**The account.** There is one, and it lives in three settings. Make them with:

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

This writes `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` to the file, with the password on its third line. Set the three on the server. The password itself is stored nowhere else: the server keeps only a hash of it. To change the password, run the script again and set the new values. Changing `ADMIN_SESSION_SECRET` signs every browser out.

- Five wrong guesses from one address lock it out for a quarter of an hour.
- A browser stays signed in for 90 days after it was last used, so a display that is left on never has to sign in again.
- The page asks search engines not to list it.

**On the Pi.** Sign in once with a keyboard, then start the browser on the page:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://<your-site>/admin
```

The browser must keep its cookies between restarts, so don't start it with `--incognito`. The page loads itself afresh after a new version of the site goes live and every six hours, always between sessions. A display that is left open also keeps the desk running: sessions start while a page is open.

## Hosting on Render

`render.yaml` describes the service: a Node web service that builds with `npm ci && npm run build`, starts with `npm run start`, and is checked at `/api/health`.

Secrets are set on Render, in the service's Environment page, and are never committed: `AI_GATEWAY_API_KEY`, `DATABASE_URL`, `CLAIM_SECRET`, `TREASURY_PRIVATE_KEY`, `USDG_ADDRESS`, the six `DESK_` settings that `scripts/deploy-desks.mjs` writes, and the three `ADMIN_` settings that `scripts/admin-password.mjs` writes.

Three things to know:

- **Values that start with `NEXT_PUBLIC_` are fixed when the site is built.** Change one, and the service must be deployed again.
- **Run one server per treasury.** Two servers paying from the same wallet at once can take each other's place in its queue of transactions. Stop a local server before using the hosted one.
- **On the free plan the service sleeps** after a quarter of an hour without visitors, and the first visit after that takes about a minute.

## If the network's name lookups are unreliable

On some networks the system's lookup of a host name fails now and then, although a plain DNS query finds the host at once. The server then asks the network's DNS server directly, and public ones after that (`src/server/dns-fallback.ts`). The scripts in `scripts/` do the same.

## Cost

A session is about 18 model calls. It cost roughly $0.10 at 12 calls; the six more are short ones, and the cost has not been measured since. One session is generated per interval no matter how many people are watching. At the default 5-minute interval that is about $1 to $2 per hour while a page is open. `COUNCIL_MAX_ROUNDS_PER_DAY` caps the daily spend. Funded agents think harder, which costs more per session.

## Before going live with real money

- Agents must trade for real first, or the treasury stays the counterparty to their results.
- Holding users' funds and paying bonuses has legal, licensing and tax consequences in most countries. Get advice.
- Keep the treasury key in a secrets manager, and keep only a day's budget in the wallet.
- The per-IP limit on rewards trusts the `x-forwarded-for` header, so the server must sit behind a proxy you control.
- Nothing on this site is financial advice.
