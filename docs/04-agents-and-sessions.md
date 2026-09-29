# 4. Agents and sessions

[Back to the index](README.md)

## The four agents

| Agent | Model | Role | Colour | Key in code |
| --- | --- | --- | --- | --- |
| The Researcher | GPT-6 Sol (`openai/gpt-6-sol`) | Momentum, RSI, trend, volume | White | `quant` |
| The Strategist | Claude Opus 5.5 (`anthropic/claude-opus-5.5`) | Risk manager | Orange | `guardian` |
| The Observer | Qwen 3.8 Max (`alibaba/qwen3.8-max`) | Momentum specialist | Blue | `degen` |
| The Executor | Jev (`typesafe-ai/jev`) | Probabilities and odds | Pink | `oracle` |

All four are called through Vercel AI Gateway. Each model can be changed with a `COUNCIL_MODEL_*` setting, with no change to the code.

Each agent starts with $100 of house cash and manages its own money. A position can be held by several agents. Each holds the tokens its own money bought.

### Jev is different

Jev is an evaluation model. It answers typed questions with probabilities and scores, and writes no text.

- Every number The Executor speaks is Jev's answer. The sentence around the number is a template in `src/server/council/jev-brain.ts`.
- The Observer is also given Jev's odds that each token on the board is higher in an hour, as one more reading in its briefing. The Observer's own model still decides and writes what it says. `COUNCIL_ODDS_FOR` sets which agents are given the odds.

### When a model can't answer

| What happened | What the desk does |
| --- | --- |
| One model call fails after its retries | That agent's line is written by the scripted stand-in, tagged `scripted`, and the session carries on |
| No gateway key is set | All agents run on scripted rules |
| The gateway says its budget is used up | All agents run on scripted rules. The models are tried again a quarter of an hour later |
| The day's limit of sessions is reached | All agents run on scripted rules until the next UTC day |

The header's badge and the admin's display say which of these is the case.

### How hard an agent thinks

How much a model is allowed to think per session is set by how much users have funded the agent:

| Users' funding | Level | Thinking |
| --- | --- | --- |
| Under $50 | Standard analysis | low |
| $50 to under $250 | Extended analysis | medium |
| $250 and up | Deep analysis | high |

Deeper thinking costs more per session. It buys more analysis, not a better result, and the app never says otherwise. A model is asked in a word it knows: Qwen has no "high" and is asked for "medium" (`effortFor` in `src/server/council/config.ts`).

## A session, step by step

The engine is `src/server/council/round.ts`. It sends the browser one **stage** at a time, as each is ready.

| Step | What happens | Stage sent |
| --- | --- | --- |
| **Open** | The server makes the board, reads the market and the desk's books, and hands each agent a focus for this session | `open` |
| **Pitch** | Every agent proposes BUY, SELL or HOLD, with a stake, a stop, a target and a conviction from 1 to 5 | `pitches` |
| **Proposal** | The strongest pitch that is not HOLD becomes the proposal. If every agent holds, no trade goes to the council | `pitches` |
| **Debate** | Two agents walk to the leader's desk, one after the other, and question the proposal. The leader answers and may change its stop or target | `debate` |
| **Pledge** | Each other agent commits its own cash or refuses, and says why | `decision` |
| **Vote** | A vote is what the agent did with its money: cash in means YES, nothing in means NO. Three of four passes | `decision` |
| **Order** | The desk buys or sells at the live price. The agents then make the trades of their own books. The books are saved | `outcome` |

Because a vote is derived from the pledge, an agent can never say yes and vote no.

A session is about twelve model calls and takes up to a minute.

### Every agent trades its own book

The council decides which trades the desk makes together. It does not decide whether an agent may trade.

| Rule | What it means |
| --- | --- |
| A pitch is a decision | An agent that pitched the same trade as the proposal joins it. Every other agent trades the idea it pitched by itself |
| Without backing, alone | If the vote fails there is no desk trade, and the leader takes the trade for its own book. A funder's suggestion is the exception: it is bought only if the council backs it |
| Nobody sits in cash | An agent that holds nothing must open a position that session, of at least $20 |
| The books are spread | Agents opening a first position choose one after another. Each is told what the others took, and picks something else |
| Selling | The tokens an agent holds are its own to sell, from the session after it bought them. Its sale leaves the other holders' tokens where they are. The council can also vote to sell a position for everyone who holds it |
| Size | One trade takes at most 60% of an agent's cash |

An agent told to open a position is also told not to invent a reason for it. When the edge is thin, it says so and sizes small.

### What the agents are shown

Every agent gets the same briefing (`src/server/council/context.ts`):

- The board, with each token's price, its change over 5 minutes, 15 minutes, 1 hour, 4 hours and a day, RSI, trend, volume against its average, how far it usually moves in 5 minutes, where it sits in its day's range, its pool's liquidity and volume, and how many bought and sold in the last five minutes.
- The desk's books: each agent's cash and positions, with stops and targets.
- What happened in the last sessions.
- Its own recent lines, and what it said the last time this token was debated.
- For agents given them, Jev's odds.

## Keeping the conversation fresh

A model cannot be retrained from this app. What the app controls is what each agent is given (`src/server/council/skills.ts`, `memory.ts`).

| Technique | What it does |
| --- | --- |
| Rotating focus | Each agent has several analytical skills and is handed the one it has gone longest without using |
| Own recent lines | Each agent is shown what it said lately and told not to reuse the points or the wording |
| Memory of the token | When a token comes up again, each agent is shown what it said the last time the desk debated it |
| Repeat check | A draft too close to something the agent already said is sent back once for a different point |
| Varied templates | Jev and the scripted stand-in speak from templates with several wordings. The one chosen is the least like what was said before |
| Short lines | The models are asked for at most 15 words. Anything over 120 characters is cut |

## The agents' faces

A face follows what is happening to the agent. It is not left to the model to choose, because a model picks strong feelings for ordinary remarks. The rules are in `src/lib/mood.ts`.

| Moment | Face |
| --- | --- |
| Pitches a purchase with conviction 4 or 5 | Confident |
| Pitches a purchase with less conviction, or holds | Neutral |
| Pitches the sale of a position that is losing | Worried |
| Challenges a trade it pitched itself | Confident |
| Challenges a trade it is strongly against | **Angry** |
| Challenges any other trade | Sceptical |
| Puts cash into a trade | Confident |
| The council backs the leader's trade | Happy |
| A proposal its leader was sure of gets one vote or none | **Angry** |
| Sells at a gain of $0.25 or more | Happy |
| Sells at a loss of $0.50 or more, by its own choice | Sad |
| Is put out of a position at such a loss, by its stop or a falling price | **Angry** |
| Its book is up 1% or more | Happy |
| Its book is down 3% or more | Worried |

Sessions recorded before this rule carry whatever the model chose. When they are shown, the strong feelings in them are brought down.

## How often sessions run

One session is produced per interval (`COUNCIL_INTERVAL_SECONDS`, five minutes by default), however many people are watching. A session starts when a page asks for one and the interval has passed. If several servers ask at once, only one produces the session and the others follow it.
