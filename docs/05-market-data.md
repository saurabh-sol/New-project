# 5. Market data

[Back to the index](README.md)

All market data is public and needs no key. It always describes **Robinhood Chain mainnet**, where the tokens trade, whatever network the desk's money is on.

## The board

The board is the list of tokens the agents choose from in a session. It is made in `src/server/market/trending.ts`.

The tokens on the board are tokens launched on **Pons** ([ponsfamily.com](https://www.ponsfamily.com/launchpad)), and no others. A token launched there trades on a bonding curve of its own until enough has been paid in, and then **graduates** into a Uniswap v4 pool whose liquidity is locked. The desk trades graduated tokens, which have a pool and so a price.

| Step | What the desk does |
| --- | --- |
| Finds Pons's tokens | Reads the record of Pons's factory contract, `0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e`, for every token that graduated in the last thirty days |
| Sees how each is trading | Asks DexScreener for each token's busiest pool: its price, liquidity, and what it traded in the last hour and day. All of them every half hour, the sixty busiest every time |
| Ranks them | Most traded over the last hour first |
| Keeps what can be read | The first eight whose pool clears the limits below |

| Limit | Default | Setting |
| --- | --- | --- |
| Tokens on the board | 8 | `BOARD_SIZE` |
| The pool holds at least | $30,000 | `BOARD_MIN_LIQUIDITY_USD` |
| It traded in the last day at least | $100,000 | `BOARD_MIN_VOLUME_USD` |
| The pool is at least this old | 6 hours | `BOARD_MIN_AGE_HOURS` |

The age limit is there because the agents read three hours of candles. A younger pool has too few.

**When the chain can't be read**, the board is made from GeckoTerminal's lists of Pons's pools instead. Each token is checked against the factory's record once the chain answers again. Tokens of the first version of Pons, which the present factory has no record of, come onto the board only that way.

**To trade the whole chain**, set `BOARD_LAUNCHPAD=any`. The board is then whatever is trending on Robinhood Chain, from any launchpad.

Left off the board in every case: ETH, Stock Tokens, and money such as USDG.

## Prices

| What | Source | How often |
| --- | --- | --- |
| Tokens on the board and tokens held | DexScreener, the whole list in one request | The page asks every 5 seconds |
| A Stock Token the desk holds | Robinhood's Stock Token API | With the same request, only while the desk holds one |
| ETH, if the desk holds any | Binance, and CoinGecko when Binance can't be reached | The same |

A quote carries the price, the change over 5 minutes, 1 hour and 24 hours, and how many bought and sold in the last five minutes.

## Candles

| What | Source |
| --- | --- |
| A token on the board, stretches up to a day | The pool's own record of its swaps on Robinhood Chain, put in USD at the live price (`src/server/market/chain-candles.ts`) |
| The same, for longer stretches or when the chain can't be read | GeckoTerminal |
| A Stock Token | Yahoo Finance's public chart data, scaled by the token's multiplier |
| ETH | Binance |

The chart offers candles of 1 minute, 5 minutes, 15 minutes and 1 hour.

## What the agents' figures are made from

The figures in an agent's briefing are computed on the server from 5-minute candles (`src/server/council/stats.ts`):

| Figure | What it is |
| --- | --- |
| RSI | Over 14 candles |
| Trend | A short moving average against a long one: up, down or flat |
| Volume ratio | The last 15 minutes against the average of the two hours before |
| Usual movement | Average true range as a percent of price: how far the token typically moves in 5 minutes |
| Place in range | Where the price sits in its 24-hour range, from 0 (low) to 100 (high) |

## Things to know about this data

- **The public services allow few requests.** DexScreener allows 300 a minute, GeckoTerminal far fewer. Requests are paced, answers are shared between viewers, and the last good answer is kept when a refresh fails (`src/server/market/http.ts`).
- **The chain's public endpoint reads at most about a million blocks per request**, which is roughly 28 hours. Pons's record is read in stretches of that size and remembered.
- **Robinhood publishes live prices for Stock Tokens but no history.** A Stock Token's candles are the underlying share's, scaled by the token's multiplier.
- **Yahoo Finance's chart data is public but unofficial.** It can change without notice.
- **If a source can't be reached**, a token drops off the board for that session, a request waits, or a chart does not load. Nothing is traded on a price the desk could not read.

## Every source in one table

| Data | Source | Key needed |
| --- | --- | --- |
| Which tokens were launched on Pons | The Pons factory's record on Robinhood Chain | No |
| Which of them are trending, their prices and pools | DexScreener | No |
| The same, when the chain can't be read | GeckoTerminal | No |
| Candles of pool tokens | The pools' swap records on Robinhood Chain, then GeckoTerminal | No |
| Stock Tokens: list and live price | Robinhood's Stock Token API | No |
| Stock Tokens: candles | Yahoo Finance | No |
| ETH | Binance, then CoinGecko | No |
| The agents' words and decisions | Vercel AI Gateway | Yes |
| Balances and transfers | Robinhood Chain | No |
