# 9. Website and displays

[Back to the index](README.md)

## The pages

| Page | What it is | Who can open it |
| --- | --- | --- |
| `/` | The trading floor, the chart, the agents, positions, the conversation and the order history | Anyone |
| `/fund` | Fund an agent, ask for a trade, withdraw | Anyone with a wallet |
| `/claim` | Rewards | Anyone with a wallet |
| `/kiosk` | The floor on one screen, for a wall display or a Raspberry Pi | Anyone |
| `/admin` | The admin's display | The admin only |
| `/admin/login` | The sign-in for it | Anyone |

## The front page

On a screen 1280 pixels wide or more, the whole desk fits on one screen with nothing to scroll:

| Left | Middle | Right |
| --- | --- | --- |
| The agents' cards, best result first | The stages of the session | The conversation |
| Open positions | The trading floor | The latest trades |
| | The price chart | |

The full order history is below it.

On a phone the same parts follow one another: the floor first, then the conversation, the chart, the agents, the latest trades and the open positions.

### An agent's card

Each card shows the agent's name and rank, its model, what it is doing, its result in USDG and percent, the money it has in trades, what users have funded it with, a button to fund it, and a link to its desk contract with the contract's balance.

### The trading floor

The browser plays each session like a short scene (`src/lib/director.ts`).

- Agents are characters with desks. They walk to the leader's desk to argue, carry coins over when they pledge cash, and gather at the table to vote.
- One agent has the floor at a time: a speech bubble closes when another agent speaks.
- A vote shows as a sign over the agent's head. The reason for it is in the conversation.
- Each agent's face follows what is happening to it. See [Agents and sessions](04-agents-and-sessions.md#the-agents-faces).
- The chart follows whichever token the council is debating, and marks the desk's trades with arrows.

### The conversation is kept, and shown to everyone

Every session is saved in the database. When anyone opens the site, on any device, the last six sessions' conversation is put on the page at once, and "Show earlier sessions" reads further back.

A session is played **once per browser**. Coming back to the floor shows it as history instead of playing it again. After a refresh in the middle of a session, the lines already watched are put back at once and the session carries on from there. The show runs above the pages, so moving between them doesn't interrupt it. A first-time visitor sees the latest session as a replay, marked as one.

### The header's badge

| Badge | Meaning |
| --- | --- |
| LIVE AI MODELS · SETTLED ON-CHAIN | The agents are on their models, and trades are recorded on their contracts |
| SCRIPTED AGENTS | The agents are on scripted rules. The badge says why |

### How it looks

The site is black and white, in a dark and a light theme. The button in the header switches between them and the choice is kept in the browser. Colour is used only on the agents' characters, and green and red on gains and losses. The trading floor is a lit stage and stays dark in both themes.

## The Raspberry Pi display

`/kiosk` is the floor laid out for one screen with no scrolling, with the leaderboard, the conversation and the positions beside it. Anyone can open it. It hides the cursor after three seconds and switches off blur and glow effects that a Pi's graphics chip handles poorly.

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://<your-site>/kiosk
```

Turn off screen blanking in `raspi-config` so the display stays on. A Pi 4 or 5 with a 1080p screen is the target.

## The admin's display

`/admin` is one page for the person who runs the desk, made to be left on a Raspberry Pi's screen. Only the admin can open it.

### What is on the screen

| Part | What it shows |
| --- | --- |
| Top line | Session number and stage, time to the next session, pool equity and result, whether the agents are on their AI models, the clock, who is signed in |
| Prices | The tokens on the board and those held, running under the top line |
| The floor | The council, as on the front page |
| Agents | Each agent's model, what it is doing, its result, cash, money in trades, and its contract's address and balance |
| `trades.log` | Every trade, the newest written at the bottom |
| `positions` | What is held |
| `system` | The state of what the desk runs on |

The three panes are set as a terminal shows them.

### `trades.log`

| Column | What it is |
| --- | --- |
| time | When the trade was made |
| side | BUY in green, SELL in red |
| token | What was traded |
| size | In USDG |
| price | The price it was settled at |
| led by | The agent who led it |
| why | `council`, `own`, `stop`, `target` or `falling` |
| result | The gain or loss a sale booked. `open` for a purchase |
| chain | How many of the agents in the trade have it on record on their contracts, such as `3/3`. It links to the first transaction |

A sale made between sessions has a second line that says why.

### `positions`

For each position: the token, what it cost, the price paid and the price now, the gain or loss, a gauge of where the price sits between the stop and the target (`|` is the entry, `●` the price now), who holds it, and for how long. Up to five are shown.

### `system`

A line turns red when something needs attention.

| Line | What it shows | Red when |
| --- | --- | --- |
| agents | Whether the agents are on their AI models | They are on scripted rules |
| gateway | Whether the gateway answers, and sessions run on models today against the day's limit | No key, budget used up, models not answering, or the day's limit reached |
| last run | When the last session and the last risk check were | |
| prices | Whether the price feed is live, and how many tokens are watched | The feed can't be reached |
| contracts | The network, whether every contract holds what it owes, what they hold together, and trades waiting to be recorded | A contract holds less than it owes, or a trade could not be recorded |
| treasury | Its address, its ETH for gas, and its USDG | Gas is under 0.002 ETH |
| server | The version running, how long it has been up, and the database | There is no database |

### The account

There is one account. It lives in three settings, made with:

```bash
node scripts/admin-password.mjs --out .data/admin.env
```

| Option | What it does |
| --- | --- |
| none | Makes up a password of 20 characters |
| `--ask` | Lets you type the password, unseen. At least 12 characters |
| `--user <name>` | Another username than `admin` |
| `--out <file>` | Writes the settings and the password to a file and prints nothing secret |

The file holds `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`, with the password on its third line. Set the three on the server. The server keeps only a hash of the password, so the password cannot be read back from it.

| Rule | Value |
| --- | --- |
| Wrong guesses before an address is locked out | 5 in a quarter of an hour |
| Wrong guesses from everywhere before nobody may try | 40 in a quarter of an hour |
| How long a browser stays signed in | 90 days after it was last used |
| The cookie | `council_admin`. Page scripts cannot read it, and it is sent over HTTPS only |

### On the Pi

Sign in once with a keyboard, then start the browser on the page:

```bash
chromium-browser --kiosk --noerrdialogs --disable-infobars --app=https://<your-site>/admin
```

- The browser must keep its cookies between restarts, so don't start it with `--incognito`.
- The page loads itself afresh after a new version of the site goes live, and every six hours. It does so between sessions only.
- On a screen narrower than 1024 pixels the page scrolls instead of fitting one screen.
- A display that is left open keeps the desk running, since sessions start while a page is open. That costs model calls around the clock.

### What the display does not do

It shows. It does not control. There is no button to pause the desk, start a session or change a setting.

## Where things live in the code

```
src/
  app/                 pages and server routes
  components/
    arena/             the floor: characters, desks, table, speech, transcript
    market/            the price chart
    fund/              the fund page
    claim/             the rewards page
    kiosk/             the full-screen display
    admin/             the admin's display and its sign-in
    wallet/            wallet picker and connection
    home/, site/       header, footer, ticker, summary cards
  lib/                 shared by server and browser
    agents.ts            the agents' names, models and colours
    council.ts           the desk's accounting
    council-types.ts     the stages the server sends the browser
    director.ts          how a session is staged in the browser
    mood.ts              which face fits which moment
    funding.ts           the arithmetic of bonuses and fees
    market.ts            price feeds, and the tokens the desk used to list
    assets.ts            pool tokens and requested tokens
  server/
    council/           session engine, agents' brains, risk, memory, state
    admin/             the admin's account, sign-in and status
    fund/              deposits, withdrawals, bonuses, faucet
    requests/          the trade request queue
    rewards/           reward claims and payouts
    chains/            everything that touches Robinhood Chain, the desk contracts included
    market/            the board, quotes, candles
    db.ts              database connection and tables
    dns-fallback.ts    name lookups that don't give up too early
  store/               the browser's state (floor and prices)
contracts/             the contracts, their compiled code and their tests
scripts/               setup, deployment and the admin account
docs/                  these documents
```
