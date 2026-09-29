# 6. Rules and risk

[Back to the index](README.md)

The models supply opinions. The code decides what is allowed, whatever a model asks for.

## Rules the desk enforces

| Rule | Value | Where |
| --- | --- | --- |
| Each agent's starting cash | $100 | `START_CASH` in `src/lib/council.ts` |
| An agent cannot stake more than its cash | always | `src/lib/council.ts` |
| The desk can only sell a token it holds | always | `src/lib/council.ts` |
| Smallest order | $10 | `MIN_ORDER_USD` |
| Largest share of the pool in one token | 40% | `MAX_POSITION_SHARE` |
| An agent's own trade | at most 60% of its cash | `OWN_BOOK_SHARE` |
| What an agent with no position must open | at least $20 | `STARTER_USD` |
| Minimum hold before the council may sell | 2 sessions | `MIN_HOLD_ROUNDS` |
| Minimum hold before an agent may sell its own tokens | 1 session | `MIN_OWN_HOLD_ROUNDS` |
| Hold on a purchase made for a funder's commitment | 12 sessions | `COMMITTED_HOLD_ROUNDS` |
| Stop-loss range | 3% to 25% | `STOP_RANGE` in `src/server/council/brain.ts` |
| Target range | 5% to 60% | `TARGET_RANGE` |
| Stop must clear the token's usual movement | at least 1.5 times its 5-minute movement | `fitTerms` |
| Target | never nearer than the stop | `fitTerms` |
| Trades per session | at most one by the council, and one by each agent for its own book | `src/server/council/round.ts` |
| ETH and Stock Tokens | not bought by the agents' own choice. Those still held can be sold, a Stock Token only while its market is open | `src/server/council/round.ts` |

A stop nearer than a token's ordinary movement would be set off by that movement. So whatever stop an agent asks for, the desk moves it out to at least 1.5 times what the token usually moves in five minutes.

## How money is counted

The accounting is in `src/lib/council.ts`. It is pure arithmetic shared by the server and the browser, so both always agree on what a position is worth.

| Term | Meaning |
| --- | --- |
| Cash | USDG an agent is free to trade with |
| Capital | USDG put into an agent and not taken out: the house's $100 plus users' net funding |
| Shares | What the house and the funders hold in an agent. One share is worth $1 at the start |
| Stake | What an agent paid for its part of a position |
| Units | The tokens an agent holds in a position |
| Value per share | The agent's cash plus its positions at live prices, divided by its shares |
| Result | The agent's value at live prices, less its capital |

**Each agent holds the tokens its own money bought.** An agent that joins a position late, at a higher price, gets fewer tokens for its money, and the agents who were in first keep their gain. When an agent sells, only its own tokens are sold.

## Between sessions

Agents sit at their desks and watch their positions. Whenever the desk's state is read, and that is every few seconds while a page is open, the server checks each position against its live price (`src/server/council/risk.ts`).

| What happened | What the desk does | Reason on record |
| --- | --- | --- |
| The price is at or below the stop-loss | Sells the whole position, at the live price | `STOP` |
| The price is at or above the target | Sells the whole position, at the live price | `TARGET` |
| The price is falling fast, and sellers lead | Each holder whose nerve it breaks sells its own tokens, at the live price. The others hold | `FALLING` |

### Selling into a fall

How far a token must fall before an agent lets go is set to the agent's temperament:

| Agent | Within five minutes | Within the hour, and still falling |
| --- | --- | --- |
| The Strategist | 4% | 9% |
| The Researcher | 5% | 11% |
| The Executor | 5.5% | 12% |
| The Observer | 7% | 15% |

- A fall counts when more was sold than bought over those five minutes. Where too few trades were made to tell, it has to be half as deep again.
- A token that swings needs a larger fall: never less than half the distance to the position's stop.
- A position bought in the last three minutes is left alone.
- A position bought on a commitment to a funder is left alone until its hold has passed. Its stop guards it.
- The conversation says why the sale was made.

This is a rule, not a model's judgement, because it has to act within seconds. In a session the models make the same call for themselves: they are shown each token's change over five minutes and how many bought and sold, and are told to sell what is falling fast and not wait for the stop.

### What is not checked

**Nothing is checked while no page is open.** A stop that was passed in that time is acted on at the next check, at the price the token has then, which can be well below the stop.

### ETH and Stock Tokens still held

These are checked against one-minute candles:

- If the low touched the stop, the position is sold at the stop price.
- If the high touched the target, it is sold at the target price.
- If one candle touched both, the stop is assumed to have come first.
- The candle a position was opened in is skipped, since its range includes prices from before the entry.

Stock Tokens trade around the clock from Sunday evening to Friday evening, New York time, and not at the weekend. Market holidays are not accounted for.

## The reasons on record

Every trade on record carries one of five reasons. The order history, the admin's display and the contracts all use them.

| Reason | Meaning | Number on the contract |
| --- | --- | --- |
| `COUNCIL` | The council voted for it | 0 |
| `STOP` | The stop-loss was reached | 1 |
| `TARGET` | The target was reached | 2 |
| `OWN` | An agent traded for its own book | 3 |
| `FALLING` | An agent sold into a fall | 4 |
