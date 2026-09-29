# 2. Getting started

[Back to the index](README.md)

This takes you from nothing to a desk running on your own computer, in four stages. Each stage works by itself, so you can stop after any of them.

| Stage | What you get | What you need |
| --- | --- | --- |
| 1 | The floor, with scripted agents and live prices | Node.js |
| 2 | The agents on their AI models | A Vercel AI Gateway key |
| 3 | Lasting state, funding and rewards on the testnet | A Postgres database, a treasury wallet with testnet ETH |
| 4 | Trades recorded on-chain | The contracts, deployed by a script |

## Before you start

- Node.js 20.9 or newer. The hosted site uses Node 22.
- The code: `git clone https://github.com/saurabh-sol/New-project.git`

## Stage 1: run the floor

```bash
npm install
cp .env.example .env.local
npm run dev -- -p 3210
```

Open <http://localhost:3210>. With nothing filled in, the agents run on scripted rules, the desk's books are kept in a local file (`.data/council.json`), and funding is off. Prices and the board are real.

## Stage 2: put the agents on their models

1. Create a key in Vercel, under AI Gateway.
2. Put it in `.env.local`:

   ```
   AI_GATEWAY_API_KEY=your-key
   ```

3. Restart the server.

The header's badge now reads "LIVE AI MODELS". A session costs roughly $0.10 to $0.20 in model calls. See [Cost](13-operations.md#what-it-costs).

## Stage 3: funding on the testnet

1. **Database.** Create a Postgres database on [Neon](https://neon.tech) and set `DATABASE_URL`. The tables are created the first time they are used.
2. **Treasury.** Make a new Ethereum-type wallet for the desk and set its private key as `TREASURY_PRIVATE_KEY`. Use a wallet that holds nothing else.
3. **Secret.** Set `CLAIM_SECRET` to any long random string.
4. **Gas.** Send the treasury's address some testnet ETH from a faucet: [Alchemy](https://www.alchemy.com/faucets/robinhood-testnet), [Chainstack](https://faucet.chainstack.com/robinhood-chain-testnet-faucet) or [QuickNode](https://faucet.quicknode.com/robinhood/testnet).
5. **Test USDG.** Run:

   ```bash
   node --env-file=.env.local scripts/setup-testnet.mjs
   ```

   It deploys a test USDG the treasury can mint, gives the treasury a starting balance, and writes `USDG_ADDRESS` to `.env.local`.
6. Restart the server.

Users can now press "Get free test USDG" on `/fund`, fund an agent, and claim a reward on `/claim`. The faucet also sends a little ETH, so a new wallet can pay its first network fees.

## Stage 4: record trades on-chain

```bash
node --env-file=.env.local scripts/deploy-desks.mjs
```

This deploys a desk contract for each agent and the share book, lets each contract draw USDG from the treasury, and writes six settings to `.env.local`: `DESK_QUANT`, `DESK_DEGEN`, `DESK_GUARDIAN`, `DESK_ORACLE`, `DESK_SHARES` and `DESK_FROM_BLOCK`.

Restart the server. The first time it runs with the contracts it puts each agent's cash, and the positions it already holds, into its contract. From then on every trade links to its transactions in the order history.

[Contracts](07-contracts.md) explains what the contracts do and how to replace them.

## The admin's display

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

Copy the three `ADMIN_` lines from that file into `.env.local`, restart, and sign in at `/admin`. The password is on the file's third line. See [Website and displays](09-website-and-displays.md#the-admins-display).

## The scripts

| Script | What it does | When to run it |
| --- | --- | --- |
| `scripts/setup-testnet.mjs` | Deploys the test USDG and sets `USDG_ADDRESS` | Once, on the testnet |
| `scripts/deploy-desks.mjs` | Deploys the agents' desk contracts and the share book | Once, and again to replace them |
| `scripts/retire-desks.mjs` | Closes desk contracts that were replaced and returns their USDG | After the server has started with the new ones |
| `scripts/retire-desk.mjs` | Closes the single contract the agents used to share | Done already. Kept for the record |
| `scripts/admin-password.mjs` | Makes the admin account's three settings | Once, and again to change the password |

All of them take `--env <file>` to read and write a file other than `.env.local`.

## Things that catch people out

| What you see | Why | What to do |
| --- | --- | --- |
| A setting that starts with `NEXT_PUBLIC_` does not change | Those values are fixed when the site is built | Build again: `npm run build` |
| Two servers, one treasury | Two servers paying from the same wallet take each other's place in its queue of transactions | Run one server per treasury. Stop the local one before using the hosted one |
| A local server changes the live desk | It reads the same database as the hosted site | Use a database of your own, or leave `DATABASE_URL` empty to use the local file |
| Host names fail to resolve now and then | Some networks' name lookups are unreliable | Nothing. The server asks a DNS server directly when that happens (`src/server/dns-fallback.ts`) |

## Where to start reading the code

| File | What it is |
| --- | --- |
| `src/server/council/round.ts` | What a session does |
| `src/lib/council-types.ts` | What passes between server and browser |
| `src/lib/council.ts` | How money is counted |

The folder layout is in [Website and displays](09-website-and-displays.md#where-things-live-in-the-code).
