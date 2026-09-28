# The Council

Four AI agents share a trading desk. They read the same live market data, pitch trades, argue at each other's desks, commit their own cash, vote, and hold positions with stops and targets.

| Agent | Model | Role |
| --- | --- | --- |
| The Quant | GPT-6 Astra | Momentum, RSI, volume |
| The Guardian | Claude Opus 4.8 | Risk manager |
| The Degen | Grok 4.7 | Aggressive momentum |
| The Oracle | Jev | Probabilities and odds |

All four run through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway).

```bash
npm install
cp .env.example .env.local   # then add your AI_GATEWAY_API_KEY
npm run dev -- -p 3210
```

## What is real and what is not

| Part | Status |
| --- | --- |
| Prices, candles, RSI, volume | Real, from Binance's public spot market data |
| What the agents say and decide | Real model output, when a gateway key is set |
| Trades and PnL | Paper trades at real prices. Nothing is sent on-chain. |
| Reward payouts | Real SPL token transfers once a treasury is configured |

A line tagged `scripted` in the transcript was written by a rule-based stand-in, because that model could not be reached or no key is configured.

## How a session runs

1. **Pitch.** Every agent gets the same market table and the desk's positions, and proposes BUY, SELL or HOLD.
2. **Proposal.** The strongest non-HOLD pitch becomes the proposal. If everyone holds, the session ends with no trade.
3. **Debate.** Two agents walk to the leader's desk and challenge or back the proposal. The leader answers and may tighten its terms.
4. **Pledge.** Each other agent either commits its own cash or refuses, and says why.
5. **Vote.** A vote is what the agent did with its money: cash in means YES, nothing in means NO. Three of four passes.
6. **Order.** The desk buys or sells at the live price.

Between sessions the agents watch their positions. Stops and targets are checked against real one-minute candles.

### Rules the code enforces, whatever a model asks for

- Each agent starts with $100 and can never stake more than its cash.
- The desk can only sell a token it holds, and only after holding it for 2 sessions.
- No token may exceed 40% of the pool. Orders under $10 are not placed.
- Every position has a stop-loss and a profit target.

### About Jev

Jev is an evaluation model. It answers typed questions with probabilities and scores and writes no text. Every number The Oracle speaks is Jev's answer; the sentence around it is a template in `src/server/council/jev-brain.ts`.

## Cost

A session is about 12 model calls and costs roughly $0.10 to $0.20. One session is generated per interval no matter how many people are watching. At the default 5-minute interval that is up to about $1.50 to $2.50 per hour while someone has the page open. `COUNCIL_MAX_ROUNDS_PER_DAY` caps the daily spend.

## Arena Rewards (`/claim`)

The user connects a wallet, backs an agent and signs a free message. The server verifies the signature and sends USDC from a treasury wallet, which also pays the network fee.

Rewards come from a pool you fund. They are not trading profit, and the UI says so.

1. Set `TREASURY_SECRET_KEY` to a wallet that holds USDC and a little SOL. Without it the page runs in demo mode and sends nothing.
2. Set `CLAIM_SECRET` to a long random string.
3. Test on devnet first (`SOLANA_CLUSTER=devnet`), then switch to `mainnet-beta`.

Limits: one claim per wallet, a daily cap, a per-IP cap, a minimum wallet history, and an optional Cloudflare Turnstile captcha. See `.env.example`.

## Before going live

- The council's portfolio and the claim ledger are JSON files in `.data/`. That works on one server. Move both to a database before deploying to serverless hosting (including Vercel), where local files do not persist and several instances run at once.
- Each first-time reward recipient costs the treasury about 0.002 SOL in token-account rent on top of the USDC.
- Keep only a day's budget in the treasury wallet.
- Offering cash rewards may have legal and tax implications where you operate. Get advice before launch.
- Nothing on this site is financial advice.
