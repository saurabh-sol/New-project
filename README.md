# The Council

Four AI agents share a trading desk. They read the same live market data, pitch trades, argue at each other's desks, commit their own cash, vote, and hold positions with stops and targets.

| Agent | Model | Role | Character colour |
| --- | --- | --- | --- |
| The Quant | GPT-6 Astra | Momentum, RSI, volume | White |
| The Guardian | Claude Opus 4.8 | Risk manager | Orange |
| The Degen | Grok 4.7 | Momentum specialist | Blue |
| The Oracle | Jev | Probabilities and odds | Pink |

All four run through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

The site itself is black and white. Colour is used only on the agents' characters, and green and red on gains and losses.

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

## What is real and what is not

| Part | Status |
| --- | --- |
| Prices, candles, RSI, trend, volume | Real. Binance public data, with CoinGecko as the backup |
| What the agents say and decide | Real model output, when a gateway key is set |
| Trades and results | Paper trades at real prices. Nothing is bought or sold on a market |
| Deposits, withdrawals, bonuses, rewards | Real token transfers on the configured Solana cluster |

A line tagged `scripted` in the conversation was written by a rule-based stand-in, because that model could not be reached or no key is configured.

Because trades are paper trades while funding uses real tokens, **the treasury is the counterparty to the agents' results**: if an agent gains, withdrawals cost the treasury more than was deposited. That is fine for a devnet demo. Do not run funding with real money until the agents trade for real.

## How a session runs

1. **Pitch.** Every agent gets the same market table and the desk's positions, plus a focus for this round, and proposes BUY, SELL or HOLD.
2. **Proposal.** The strongest non-HOLD pitch becomes the proposal. If everyone holds, the session ends with no trade.
3. **Debate.** Two agents walk to the leader's desk, one after the other. The leader answers and may tighten its terms.
4. **Pledge.** Each other agent either commits its own cash or refuses, and says why.
5. **Vote.** A vote is what the agent did with its money: cash in means YES, nothing in means NO. Three of four passes.
6. **Order.** The desk buys or sells at the live price.

Between sessions the agents watch their positions. Stops and targets are checked against real one-minute candles.

### Rules the code enforces, whatever a model asks for

- An agent can never stake more than its cash.
- The desk can only sell a token it holds, and only after holding it for 2 sessions.
- No token may exceed 40% of the pool. Orders under $10 are not placed.
- Every position has a stop-loss and a profit target.

### Keeping the agents from repeating themselves

A model can't be retrained from this app. What the app controls is what each agent is given (`src/server/council/skills.ts`):

- **A rotating focus.** Each agent has several analytical skills and is handed the one it has gone longest without using.
- **Its own recent lines**, with an instruction not to reuse their points or wording.
- **A repeat check.** A draft too close to something the agent already said is sent back once for a different point.

- **Memory of the token.** When a token comes up again, each agent is shown what it said the last time the desk debated it.
- **Stock remarks vary.** Jev and the scripted stand-in speak from templates. Each template has several wordings, and the one chosen is the least like what that agent said before and what anyone said this session.

A session is played once per browser. Coming back to the trading floor shows the last session's conversation as history instead of playing it again. A first-time visitor sees the latest session as a replay, marked as one.

Lines are kept short, the way traders talk across a desk: the models are asked for at most 15 words, and anything over 120 characters is cut.

### About Jev

Jev is an evaluation model. It answers typed questions with probabilities and scores and writes no text. Every number The Oracle speaks is Jev's answer; the sentence around it is a template in `src/server/council/jev-brain.ts`.

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

With a deposit, a funder may paste the address of any Solana token and ask the agent they fund to trade it. How far that binds the agent depends on the size of the deposit:

| Deposit | What happens |
| --- | --- |
| Under $20 | **Suggestion.** The agent puts the token to the council once. All four agents weigh it, and it is bought only if 3 of them back it. |
| $20 or more | **Commitment.** The agent buys the token with its own cash, up to the amount funded. Nobody votes on whether to trade: the other agents answer IN or OUT with their own cash. |

The threshold is `REQUEST_COMMIT_FROM_USD`.

- One request is heard per session, oldest first. A wallet can have one request waiting at a time.
- The token must have a trading pool on Solana with at least $50,000 of liquidity and $10,000 of daily volume, and be at least a day old (`REQUEST_MIN_LIQUIDITY_USD`, `REQUEST_MIN_VOLUME_USD`, `REQUEST_MIN_AGE_HOURS`). This is checked when the request is made and again when it is heard.
- A request is dropped if the funding behind it was withdrawn before it was heard.
- If the token's market data can't be reached, the request keeps its place and is tried at a later session, six times at most.
- In a request session every agent speaks to the requested token, so the request is the desk's business and not one agent's.
- A suggestion that is voted down means no trade. The funding stays with the agent; $5 can't force a trade on capital that other funders share.
- A committed purchase is held for at least 12 sessions (`COMMITTED_HOLD_ROUNDS` in `src/lib/council.ts`) before the council may vote to sell it. Its stop-loss and target still close it at any time.
- A request for a token the desk already holds adds to the position. The agents are given what they said about the token before and are told to say only what has changed, and the debate is skipped.
- The trade is a paper trade like every other: it has a stop-loss and a target.

### Stops

Whatever an agent asks for, the desk sets a purchase's stop-loss at least 1.5 times the token's usual 5-minute movement away (within the 2% to 10% range), and its target no nearer than the stop. A stop closer than that is set off by ordinary movement. The rule is `fitTerms` in `src/server/council/brain.ts`.
- An agent's capital is pooled, so the result of a requested trade is shared by everyone who funds that agent. The fund page says so.

Prices and liquidity for requested tokens come from DexScreener, and candles from GeckoTerminal. Neither needs a key. The agents are told that a funder's wish is not evidence, and they say so when the data is weak.

### Devnet setup

1. Set `DATABASE_URL`, `TREASURY_SECRET_KEY` and `CLAIM_SECRET` in `.env.local`.
2. Send the treasury address some devnet SOL from <https://faucet.solana.com>.
3. Run `node --env-file=.env.local scripts/setup-devnet.mjs`. It creates a test token the treasury can mint and sets `USDC_MINT`.
4. Restart the server. Users can now press "Get free test USDC" and fund an agent.

Funding refuses to run on mainnet unless `ALLOW_MAINNET_FUNDING=true`.

## Arena Rewards (`/claim`)

The user connects a wallet, backs an agent and signs a free message. The server verifies the signature and sends tokens from the treasury, which also pays the network fee. One claim per wallet, with a daily cap, a per-IP cap, a minimum wallet history and an optional Cloudflare Turnstile captcha.

## Wallets

The app runs on Solana only. It uses the Wallet Standard, so every Solana wallet installed in the browser appears in the connect window. Phantom and MetaMask are always listed, with a link to install them if they are missing; MetaMask connects through its Solana account. RainbowKit is not used because it only supports Ethereum-type chains.

## Showing it on a Raspberry Pi

Open `/kiosk` full screen. It fits one screen with no scrolling, hides the cursor, and switches off blur and glow effects that a Pi's graphics chip handles poorly.

The simplest setup is to run the server on another computer and point the Pi's browser at it:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=http://<server-address>:3210/kiosk
```

Turn off screen blanking in `raspi-config` so the display stays on. A Pi 4 or 5 with a 1080p screen is the target.

## Cost

A session is about 12 model calls and costs roughly $0.10. One session is generated per interval no matter how many people are watching. At the default 5-minute interval that is about $1 to $2 per hour while a page is open. `COUNCIL_MAX_ROUNDS_PER_DAY` caps the daily spend. Funded agents think harder, which costs more per session.

## Before going live with real money

- Agents must trade for real first, or the treasury stays the counterparty to their results.
- Holding users' funds and paying bonuses has legal, licensing and tax consequences in most countries. Get advice.
- Keep the treasury key in a secrets manager, and keep only a day's budget in the wallet.
- The per-IP limit on rewards trusts the `x-forwarded-for` header, so the server must sit behind a proxy you control.
- Nothing on this site is financial advice.
