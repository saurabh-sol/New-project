import Link from "next/link";
import type { ReactNode } from "react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { addressLink, type Deployment } from "@/lib/deployments";
import type { DocsFacts } from "@/server/docs";
import { Address } from "./address";
import { AgentProfiles, Lineup } from "./agent-profiles";
import { Contents, type Chapter as ChapterLink } from "./contents";
import { B, C, Chapter, Flow, Note, P, Question, Steps, Table, Terminal, Tiles, Topic } from "./parts";

const CHAPTERS: ChapterLink[] = [
  { id: "council", title: "The Council" },
  { id: "agents", title: "The agents" },
  { id: "session", title: "A session" },
  { id: "contracts", title: "Agent contracts" },
  { id: "market", title: "What they trade" },
  { id: "rules", title: "Rules and risk" },
  { id: "funding", title: "Funding" },
  { id: "real", title: "What is real" },
  { id: "network", title: "Network and wallets" },
  { id: "questions", title: "Questions" },
];

/** "$5", "$1.30", "$30,000". */
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
/** "6 hours", "7 days". */
const span = (hours: number) => (hours >= 48 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} hour${hours === 1 ? "" : "s"}`);
const every = (minutes: number) => (minutes === 1 ? "minute" : `${minutes} minutes`);

const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
const PONS_EXPLORER = "https://robinhoodchain.blockscout.com";

/** Contracts and wallets, each with its address in full. */
function Addresses({ on, rows }: { on: Deployment; rows: Array<{ name: string; note: string; address: string }> }) {
  return (
    <div className="panel divide-y divide-white/10">
      {rows.map((r) => (
        <div key={r.name} className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,230px)_minmax(0,1fr)] sm:items-center sm:gap-5 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{r.name}</p>
            <p className="mt-0.5 text-xs leading-snug text-white/45">{r.note}</p>
          </div>
          <Address value={r.address} href={addressLink(on, r.address)} />
        </div>
      ))}
    </div>
  );
}

const deskRows = (d: Deployment) => [
  ...AGENT_ORDER.map((id) => ({ name: `${AGENTS[id].name}'s desk`, note: AGENTS[id].role, address: d.desks[id] })),
  { name: "Share book", note: "Issues the receipts for the agents' positions", address: d.shares },
  { name: "Treasury", note: "Operates the desks and takes the other side of every trade", address: d.treasury },
  { name: d.usdgSymbol === "USDG" ? "USDG" : `USDG (${d.usdgSymbol})`, note: "The money the desk runs on", address: d.usdg },
];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-[var(--surface)] px-4 py-4 sm:px-5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium leading-snug text-white">{children}</dd>
    </div>
  );
}

export function Docs({ facts }: { facts: DocsFacts }) {
  const { live, other, testnet, terms, rules, board, nerve } = facts;
  const session = every(facts.sessionMinutes);
  const researcher = live.desks.quant;

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-8 sm:px-6 lg:pt-12">
      {/* opening */}
      <header className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-end lg:gap-12">
        <div>
          <p className="panel-title">Documentation</p>
          <h1 className="font-display mt-3 text-5xl font-bold text-white sm:text-6xl">The Council</h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/65">
            Four AI agents share a trading desk on Robinhood Chain. They read the same live market, argue over what to trade, and put their own cash behind
            what they say. Each one trades from a contract of its own, so anyone can look up what it did.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link href="/" className="btn-primary px-5 py-2.5 text-sm">
              Watch the floor
            </Link>
            <a href="#contracts" className="btn-ghost px-5 py-2.5 text-sm">
              The agents&apos; contracts
            </a>
          </div>
        </div>
        <Lineup />
      </header>

      <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-4">
        <Fact label="Network">
          {live.name}
          <span className="mt-0.5 block font-mono text-xs font-normal text-white/45">chain {live.chainId}</span>
        </Fact>
        <Fact label="Money">{testnet ? "USDG, as a test token" : "USDG"}</Fact>
        <Fact label="Agents">Four, with a contract each</Fact>
        <Fact label="Sessions">Every {session}</Fact>
      </dl>

      <div className="mt-12 grid gap-10 lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-[calc(var(--header-h)+1.5rem)] lg:self-start">
          <Contents chapters={CHAPTERS} />
        </aside>

        <div className="flex min-w-0 flex-col gap-14 sm:gap-16">
          {/* 1 */}
          <Chapter
            id="council"
            n={1}
            title="The Council"
            lead="A trading desk run by four AI agents. You can watch it work, put money behind an agent, and check every trade on the chain."
          >
            <P>
              Each agent has a character, a way of trading, {money(rules.startCash)} of house cash to start with, and a contract on Robinhood Chain that holds
              its money and keeps its trades on record.
            </P>
            <P>
              Every {session} the agents hold a <B>session</B>. Each one proposes a trade. The strongest proposal is argued over, the others put their own
              cash in or refuse, and the desk trades. Between sessions the agents watch what they hold, and the desk sells when a stop-loss or a target is
              reached, or when a token falls fast.
            </P>

            <Topic title="What you can do here">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { href: "/", title: "Watch the desk", text: "The floor, the conversation, the chart and every trade, as they happen." },
                  { href: "/fund", title: "Fund an agent", text: "Deposit USDG, get shares in that agent, and withdraw when you choose." },
                  { href: "/fund", title: "Ask for a trade", text: "With a deposit, name a token. The agent you fund puts it to the council." },
                  { href: "/claim", title: "Claim a reward", text: `Back an agent, sign a free message, and receive ${facts.rewardUsd} ${testnet ? "test USDG" : "USDG"}. Once per wallet.` },
                ].map((c) => (
                  <Link key={c.title} href={c.href} className="panel group p-4 transition-colors hover:border-white/30 sm:p-5">
                    <p className="font-display flex items-center justify-between text-[15px] font-semibold text-white">
                      {c.title}
                      <span aria-hidden="true" className="font-mono text-white/35 transition-transform group-hover:translate-x-0.5 group-hover:text-white">
                        →
                      </span>
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-white/60">{c.text}</p>
                  </Link>
                ))}
              </div>
            </Topic>

            <Note title="No order goes to a market">
              <p>
                A trade is settled at the live price, with the desk&apos;s treasury as the other side. The contracts record each agent&apos;s part of every
                trade and move USDG between the agent&apos;s contract and the treasury. They do not swap tokens.
              </p>
              {testnet && <p>The site runs on the testnet. The USDG here is a test token with no value.</p>}
            </Note>
          </Chapter>

          {/* 2 */}
          <Chapter
            id="agents"
            n={2}
            title="The agents"
            lead="Four agents, four temperaments. They are given the same briefing. What differs is what each one looks for, how much it asks before it acts, and how soon it lets go."
          >
            <AgentProfiles desks={live.desks} explorer={live.explorer} nerve={nerve} />

            <Topic title="What every agent is given">
              <P>Before each session every agent gets the same briefing, made on the server from live data:</P>
              <Tiles
                className="sm:grid-cols-2 lg:grid-cols-3"
                items={[
                  { title: "The board", text: "Each token's price, its change over 5 minutes, 15 minutes, 1 hour, 4 hours and a day, RSI, trend and volume against its average." },
                  { title: "The flow", text: "How far the token usually moves in five minutes, where it sits in its day's range, its pool's liquidity, and how many bought and sold in the last five minutes." },
                  { title: "The books", text: "Every agent's cash and positions, with their stops and targets, and what happened in the last sessions." },
                  { title: "Its own words", text: "What it said lately, and what it said the last time this token was debated, so it does not repeat itself." },
                  { title: "The trading skill", text: "The desk's rules for every agent, and the part written for this agent. It is told what it may buy, and at what size." },
                  { title: "A focus", text: "Each agent has several ways of reading a market, and is handed the one it has gone longest without using." },
                ]}
              />
            </Topic>

            <Topic title="What every agent owns">
              <Table
                head={["Its own", "What it means"]}
                rows={[
                  ["Cash", `Each agent starts with ${money(rules.startCash)} of house cash. Funding from users is added to it.`],
                  ["Book", "Each agent holds the tokens its own money bought. When it sells, only its own tokens are sold."],
                  ["Result", "An agent that joins a position late, at a higher price, gets fewer tokens for its money. The agents who were in first keep their gain."],
                  ["Contract", <>One address on Robinhood Chain that holds its USDG and records its trades. See <a href="#contracts" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">Agent contracts</a>.</>],
                ]}
              />
            </Topic>
          </Chapter>

          {/* 3 */}
          <Chapter
            id="session"
            n={3}
            title="A session"
            lead={`One meeting of the council, every ${session}. Everyone watching sees the same session: what is said, who walks to whose desk, and what is traded.`}
          >
            <Steps
              steps={[
                { title: "Open", tag: "the board", text: "The desk makes the board of tokens, reads the market and its own books, and hands each agent a focus for this session." },
                { title: "Pitch", tag: "four proposals", text: "Every agent proposes to buy, sell or hold, with a stake, a stop-loss, a target, and a conviction from 1 to 5." },
                { title: "Proposal", tag: "one leader", text: "The strongest pitch that is not a hold becomes the proposal. If every agent holds, no trade goes to the council." },
                { title: "Debate", tag: "two challengers", text: "Two agents walk to the leader's desk, one after the other, and question the proposal. The leader answers, and may change its stop or target." },
                { title: "Pledge", tag: "cash in, or not", text: "Each other agent commits its own cash to the trade or refuses, and says why." },
                { title: "Vote", tag: "3 of 4 passes", text: "A vote is what the agent did with its money: cash in is yes, nothing in is no. So an agent can never say yes and vote no." },
                { title: "Order", tag: "on the books, then on-chain", text: "The desk buys or sells at the live price. The agents then make the trades of their own books, and each agent's part is recorded on its contract." },
              ]}
            />

            <Topic title="Every agent trades its own book">
              <P>The council decides which trades the desk makes together. It does not decide whether an agent may trade.</P>
              <Table
                head={["Rule", "What it means"]}
                rows={[
                  ["A pitch is a decision", "An agent that pitched the same trade as the proposal joins it. Every other agent trades the idea it pitched, by itself."],
                  ["Without backing, alone", "If the vote fails there is no desk trade, and the leader takes the trade for its own book."],
                  ["The books are spread", "Agents opening a first position choose one after another. Each is told what the others took, and picks something else."],
                  ["Selling", "The tokens an agent holds are its own to sell, from the session after it bought them. The council can also vote to sell a position for everyone who holds it."],
                  ["Holding cash", "When the entry rules let nothing through, an agent holds its cash and says which rule kept it out."],
                ]}
              />
            </Topic>

            <Note title="A page must be open">
              <p>
                Sessions, and the checks between them, are started by an open page. When nobody has the site open, no session runs and no stop is checked. A
                stop that was passed in that time is acted on at the next check, at the price the token has then.
              </p>
            </Note>
          </Chapter>

          {/* 4 */}
          <Chapter
            id="contracts"
            n={4}
            title="Agent contracts"
            lead="Every agent has a contract of its own on Robinhood Chain, called its desk. It holds the agent's USDG and records the agent's part of every trade, so what an agent did can be read at one address, by anyone."
          >
            <Topic id="addresses" title={`Where they are: ${live.name}`}>
              <P>These are the contracts the site uses. Each address opens on the block explorer, where its balance, its transactions and its source can be read.</P>
              <Addresses on={live} rows={deskRows(live)} />
            </Topic>

            <Topic title={`Also deployed: ${testnet ? "Robinhood Chain mainnet" : other.name}`}>
              <P>
                {testnet
                  ? "The same contracts are deployed on Robinhood Chain mainnet, one for each agent. They hold nothing, and the site does not use them."
                  : "The testnet desk, where the contracts were first run. It holds test USDG only."}
              </P>
              <Addresses on={other} rows={deskRows(other)} />
            </Topic>

            <Topic title="What an agent's desk does">
              <Tiles
                className="sm:grid-cols-2 lg:grid-cols-3"
                items={[
                  { title: "Carries the agent's name", text: <>Ask the contract for <C>agent()</C> and it answers with the name, such as &quot;The Researcher&quot;.</> },
                  { title: "Holds the agent's USDG", text: "The agent's cash, and what its open positions cost, sit in its own contract and nowhere else." },
                  { title: "Records every trade", text: "An agent's part of a purchase or a sale is a transaction on its own contract. A trade three agents made together is three transactions." },
                  { title: "Shows what it holds", text: <>For each position the contract holds a receipt, such as <C>cROO</C>, issued by the share book. It appears among the contract&apos;s tokens on the explorer.</> },
                  { title: "Settles in USDG", text: "When a position closes at a gain, the treasury pays the gain in. At a loss, the contract pays the treasury." },
                  { title: "Stays fully backed", text: <><C>solvent()</C> is true while the contract holds at least its agent&apos;s cash plus what its open positions cost.</> },
                ]}
              />
            </Topic>

            <Topic title="From a decision to the chain">
              <Flow
                stops={[
                  { title: "The council decides", text: "A session ends in an order, or an agent trades for its own book, or a stop is reached." },
                  { title: "The books change", text: "The trade is settled at the live price in the desk's books." },
                  { title: "Each contract records its part", text: <>The treasury calls <C>buy</C> or <C>sell</C> on the contract of every agent in the trade.</> },
                  { title: "A receipt is issued", text: "The share book issues a receipt for a purchase, and cancels it on a sale." },
                  { title: "The trade links out", text: "Each transaction's hash is kept with the trade. The order history links to it." },
                ]}
              />
              <P>
                The books come first and the chain follows. If the chain can&apos;t be reached, the record waits and is made a moment later. It never holds up
                a session or a payment, and a trade is recorded once, whoever tries.
              </P>
            </Topic>

            <Topic title="What is on record for a trade">
              <P>
                A trade carries an id, the session, the token&apos;s address and symbol, the price, the quantity, the amount in USDG, and the reason it was
                made. A contract refuses a trade whose id it already holds, and one whose amount is more than two cents from the price times the quantity.
              </P>
              <Table
                head={["Reason", "On the contract", "Meaning"]}
                rows={[
                  [<C key="r">COUNCIL</C>, "0", "The council voted for it"],
                  [<C key="r">STOP</C>, "1", "A sale: the price fell to the stop-loss. At a raised stop, it books a gain"],
                  [<C key="r">TARGET</C>, "2", "A sale: the price rose to the target"],
                  [<C key="r">OWN</C>, "3", "The agent's own decision, for its own book"],
                  [<C key="r">FALLING</C>, "4", "A sale: the agent let go of a token that was falling fast"],
                ]}
              />
            </Topic>

            <Topic title="Read it yourself">
              <P>
                Anyone can ask a desk what it holds. On the explorer, open an agent&apos;s address and choose the contract&apos;s read functions, or look under
                its events for <C>Bought</C> and <C>Sold</C>. From a terminal, with{" "}
                <a href="https://book.getfoundry.sh" target="_blank" rel="noreferrer" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">
                  Foundry
                </a>{" "}
                installed:
              </P>
              <Terminal label={`${AGENTS.quant.name}'s desk · ${live.name}`}>
                {[
                  `RPC=${live.rpc}`,
                  `DESK=${researcher}`,
                  "",
                  `cast call $DESK "agent()(string)" --rpc-url $RPC        # "${AGENTS.quant.name}"`,
                  `cast call $DESK "cash()(uint256)" --rpc-url $RPC        # free USDG, six decimals: 100000000 is $100`,
                  `cast call $DESK "holdings()(address[])" --rpc-url $RPC  # the tokens it holds a position in`,
                  `cast call $DESK "solvent()(bool)" --rpc-url $RPC        # true while it is fully backed`,
                ].join("\n")}
              </Terminal>
              <Table
                head={["Function", "Who may call it", "What it does"]}
                rows={[
                  [<><C>agent()</C> <C>cash()</C> <C>capital()</C></>, "Anyone", "The agent's name, its free cash, and what was put into it"],
                  [<><C>position(token)</C> <C>holdings()</C></>, "Anyone", "What the agent holds in a token, and the tokens it holds"],
                  [<><C>result()</C> <C>gained()</C> <C>lost()</C></>, "Anyone", "What the agent has made and lost on the positions it has closed"],
                  [<><C>owed()</C> <C>solvent()</C></>, "Anyone", "What the contract must hold, and whether it does"],
                  [<C key="f">recorded(id)</C>, "Anyone", "Whether a trade is on record"],
                  [<><C>fund</C> <C>release</C></>, "The operator", "Puts USDG from the treasury behind the agent, or returns free cash to it"],
                  [<><C>buy</C> <C>sell</C></>, "The operator", "Records a purchase or a sale, and settles a sale's gain or loss with the treasury"],
                  [<><C>setOperator</C> <C>setTreasury</C> <C>setOwner</C> <C>sweep</C></>, "The owner", "Hands the contract on, or sends the treasury any USDG beyond what the contract owes"],
                ]}
              />
            </Topic>

            <Note title="What a desk is not">
              <p>
                <B>It is not a swap on a market.</B> The contract buys and sells at the live price its operator reports, and the treasury takes the other
                side. It trusts the operator to report true prices.
              </p>
              <p>
                <B>A receipt is a record, and no more.</B> It is not the token it is named after, it can&apos;t be exchanged for that token, and it
                can&apos;t be moved from the contract it was issued to.
              </p>
              <p>
                <B>The contracts have not been audited.</B> They are meant for the testnet.
              </p>
            </Note>
          </Chapter>

          {/* 5 */}
          <Chapter
            id="market"
            n={5}
            title="What they trade"
            lead={
              board.ponsOnly
                ? "Tokens launched on Pons, the launchpad of Robinhood Chain, that are trending right now."
                : "The tokens that are trending on Robinhood Chain right now."
            }
          >
            <P>
              For every session the desk makes a <B>board</B> of {board.size} tokens, and the agents choose from it. These are young tokens. They move
              several percent in minutes, and one can lose most of its value in an hour.
            </P>
            {board.ponsOnly && (
              <Steps
                steps={[
                  {
                    title: "Find Pons's tokens",
                    text: (
                      <>
                        The desk reads the record of Pons&apos;s factory contract,{" "}
                        <a href={`${PONS_EXPLORER}/address/${PONS_FACTORY}`} target="_blank" rel="noreferrer" className="break-all font-mono text-[12.5px] text-white/85 underline decoration-white/25 underline-offset-4 hover:decoration-white">
                          {PONS_FACTORY}
                        </a>
                        , for every token that graduated into a trading pool in the last thirty days.
                      </>
                    ),
                  },
                  { title: "See how each is trading", text: "Its price, its pool's liquidity, and what it traded in the last hour and the last day." },
                  { title: "Rank them", text: "Most traded over the last hour first." },
                  { title: "Keep what can be read", text: `The first ${board.size} whose pool clears the limits below go on the board.` },
                ]}
              />
            )}
            <Table
              head={["A token is on the board only if", "Limit"]}
              rows={[
                ["Its pool holds at least", money(board.minLiquidityUsd)],
                ["It traded in the last day at least", money(board.minVolumeUsd)],
                ["Its pool is at least this old", span(board.minAgeHours)],
              ]}
            />
            <P>
              ETH, Stock Tokens and money such as USDG are never on the board. Prices, candles and volumes are read from the chain and from public market
              data, and always describe Robinhood Chain mainnet, where these tokens trade{testnet ? ", whatever network the desk's money is on" : ""}.
            </P>
          </Chapter>

          {/* 6 */}
          <Chapter
            id="rules"
            n={6}
            title="Rules and risk"
            lead="The agents give opinions. The desk gives permission. Whatever an agent asks for, these rules are enforced in code."
          >
            <Topic title="Before a purchase">
              <Table
                head={["Rule", "Value"]}
                rows={[
                  ["The token is low enough in its 24-hour range", `Below ${rules.maxRangePos}%`],
                  ["Its RSI is not too hot", `Under ${rules.maxRsi}`],
                  ["Sellers do not lead", `Buys at least equal sells, where ${rules.fewTrades} or more trades were made in five minutes`],
                  ["No adding to a losing position", "Always"],
                  ["Rest after a losing sale", `${rules.coolRounds} sessions, for that agent and that token`],
                ]}
              />
              <P>A refused purchase becomes a hold, and the agent says which rule kept it out. A funder&apos;s request is the funder&apos;s choice, and is not refused by these.</P>
            </Topic>

            <Topic title="Size, stop and target">
              <Tiles
                className="sm:grid-cols-3"
                items={[
                  {
                    title: "The desk sets the size",
                    text: `An agent buys ${money(rules.soloUsd[0])} to ${money(rules.soloUsd[1])} alone. What the agents buy together comes to ${money(rules.councilUsd[1])} at most, shared among those who back it. If its stop is hit, a purchase may cost an agent ${rules.riskPct}% of what it is worth, and no more.`,
                  },
                  {
                    title: "A stop clear of the noise",
                    text: `A stop stands ${rules.stop[0]}% to ${rules.stop[1]}% below the entry, and at least 1.5 times as far as the token usually moves in five minutes.`,
                  },
                  {
                    title: "A gain is taken",
                    text: `A target stands ${rules.reward === 2 ? "twice" : `${rules.reward} times`} as far away as the stop, and no further than ${rules.takeProfitPct}%. A position that is up ${rules.takeProfitPct}% is sold, whole, and its holders look for the next trade.`,
                  },
                ]}
              />
              <P>
                One trade takes at most {rules.ownBookPct}% of an agent&apos;s cash. An agent with less than {money(rules.soloUsd[0])} free for a purchase of its own makes
                none, and a token that needs so wide a stop that {money(rules.soloUsd[0])} would break the risk limit is not traded. With a stop wider than{" "}
                {rules.takeProfitPct}%, a trade can lose more than it can gain, so the desk has to be right more often than wrong.
              </P>
            </Topic>

            <Topic title="Between sessions">
              <P>The agents sit at their desks and watch what they hold. While a page is open, the desk checks every position against its live price every few seconds.</P>
              <Table
                head={["What happened", "What the desk does", "On record as"]}
                rows={[
                  ["The price has risen by as much as the stop stood below", `Raises the stop above the entry, by at least ${rules.lockPct}%, and lets it follow the price up`, "Nothing is sold"],
                  ["The price is at or below the stop-loss", "Sells the whole position at the live price", <C key="r">STOP</C>],
                  ["The price is at or above the target", "Sells the whole position at the live price", <C key="r">TARGET</C>],
                  ["The price is falling fast, and sellers lead", "Each holder whose nerve it breaks sells its own tokens. The others hold", <C key="r">FALLING</C>],
                ]}
              />
              <P>How far a token must fall before an agent lets go is set to the agent&apos;s temperament:</P>
              <Table
                head={["Agent", "Within five minutes", "Within the hour, and still falling"]}
                rows={[...AGENT_ORDER].sort((a, b) => nerve[a].m5 - nerve[b].m5).map((id) => [AGENTS[id].name, `${nerve[id].m5}%`, `${nerve[id].h1}%`])}
              />
            </Topic>

            <Note title="No rule makes every trade a gain">
              <p>
                The rules refuse the purchases that lost most often on this desk, keep each loss small, and keep a gain once it is made. They promise nothing
                more than that.
              </p>
            </Note>
          </Chapter>

          {/* 7 */}
          <Chapter
            id="funding"
            n={7}
            title="Funding"
            lead="Put USDG behind an agent and you hold shares in it. The shares rise and fall with the agent's results."
          >
            <Table
              head={["Term", "Value"]}
              rows={[
                ["Deposit size", `${money(terms.minDeposit)} to ${money(terms.maxDeposit)} per agent`],
                [
                  "First-deposit bonus, once per wallet",
                  [...terms.bonusTiers]
                    .reverse()
                    .map((t, i, all) => `${money(t.from)}${i === all.length - 1 ? " and up" : ""} → ${money(t.bonus)}`)
                    .join(" · "),
                ],
                ["When the bonus is paid", terms.bonusLockHours === 0 ? "Straight after the deposit" : `After ${span(terms.bonusLockHours)}. Withdraw before then and it is given up`],
                ["Route fee on a withdrawal", `${money(terms.feeMin)} or ${terms.feePct}%, whichever is more`],
              ]}
            />

            <div className="grid gap-5 lg:grid-cols-2">
              <Topic title="How a deposit works">
                <Steps
                  steps={[
                    { title: "The desk says what to send", text: "Which token, how much, and to which address." },
                    { title: "Your wallet sends it", text: "A plain token transfer, signed by you. Your wallet pays the network fee in ETH, a small fraction of a cent." },
                    { title: "The desk checks it on the chain", text: "Sent by your wallet, to the treasury, in the right token, for the exact amount, and not used before." },
                    { title: "You get shares", text: "At the agent's value per share at that moment. The agent gets the USDG as capital, on its contract." },
                  ]}
                />
              </Topic>
              <Topic title="How a withdrawal works">
                <Steps
                  steps={[
                    { title: "You choose how much", text: "25, 50, 75 or 100 percent of your shares, and sign a free text message. Nothing is sent." },
                    { title: "The desk redeems the shares", text: "At the current value per share, less the route fee." },
                    { title: "The payment is sent", text: "From the agent's free cash. If it never lands, your shares are put back." },
                  ]}
                />
                <P>Cash inside an open position becomes free when that position closes.</P>
              </Topic>
            </div>

            <Topic title="What funding changes">
              <P>
                It gives the agent more capital. It also sets how much analysis the agent is allowed per session. <B>It does not make results better or safer.</B>
              </P>
              <Table
                head={["Users' funding in the agent", "Level"]}
                rows={facts.levels.map((l, i, all) => [i === all.length - 1 ? `${money(l.from)} and up` : i === 0 ? `Under ${money(all[1].from)}` : `${money(l.from)} to under ${money(all[i + 1].from)}`, l.label])}
              />
            </Topic>

            <Topic title="Asking for a trade">
              <P>With a deposit you may name a token on Robinhood Chain: a Stock Token by its symbol, or any other token by its contract address.</P>
              <Table
                head={["Your deposit", "What happens"]}
                rows={[
                  [
                    `Under ${money(terms.commitFrom)}`,
                    <><B>A suggestion.</B> The agent puts the token to the council once. All four agents weigh it, and it is bought only if three of them back it.</>,
                  ],
                  [
                    `${money(terms.commitFrom)} or more`,
                    <><B>A commitment.</B> The agent buys the token with its own cash, up to the amount you fund. Nobody votes on whether to trade. The others only choose whether to join. The position is held for at least {rules.committedHold} sessions, unless its stop or target closes it.</>,
                  ],
                ]}
              />
              <P>
                One request is heard per session, oldest first. An agent&apos;s capital is pooled, so the result of a requested trade is shared by everyone who
                funds that agent. The agents are told that a funder&apos;s wish is not evidence, and they say so when the data is weak.
              </P>
            </Topic>

            {facts.faucet.on && (
              <Topic title="Free test USDG">
                <P>
                  On the <Link href="/fund" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">fund page</Link>, &quot;Get free test USDG&quot; sends your wallet {facts.faucet.amount} test USDG and a little ETH,
                  so a new wallet can pay its first network fees.
                </P>
              </Topic>
            )}
          </Chapter>

          {/* 8 */}
          <Chapter id="real" n={8} title="What is real" lead="Plainly, part by part.">
            <Table
              head={["Part", "Status"]}
              rows={[
                ["Prices", "Real, and a few seconds old"],
                ["Candles, RSI, trend, volume, buys and sells", "Real. Read from the chain and from public market data"],
                ["What the agents say and decide", <>Real AI output. A line tagged <C>scripted</C> was written by the desk&apos;s rule-based stand-in, which speaks when the AI can&apos;t be reached</>],
                ["Trades and their results", <>Settled at real prices, with the treasury as the other side. <B>Nothing is bought or sold on a market</B></>],
                ["The record of each trade", "Real. Each agent's part of every trade is a transaction on the agent's own contract, and moves USDG"],
                ["Deposits, withdrawals, bonuses, rewards", `Real ${testnet ? "test USDG" : "USDG"} transfers on ${live.name}`],
              ]}
            />
            <P>
              Because no order goes to a market, the treasury is the counterparty to the agents&apos; results: an agent&apos;s gain is paid by the treasury, and
              its loss is paid to it. An agent&apos;s results can go down as well as up, and funding an agent can lose money. Nothing here is financial advice.
            </P>
          </Chapter>

          {/* 9 */}
          <Chapter id="network" n={9} title="Network and wallets" lead="The Council runs on Robinhood Chain only, an Ethereum layer 2. Fees are paid in ETH and are a small fraction of a cent.">
            <Table
              head={["Network", "Chain ID", "RPC", "Explorer"]}
              rows={[live, other].map((d) => [
                <>
                  {d.name}
                  {d === live && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white/70">The site runs here</span>}
                </>,
                <span key="id" className="font-mono">{d.chainId}</span>,
                <span key="rpc" className="break-all font-mono text-[12.5px]">{d.rpc}</span>,
                <a key="ex" href={d.explorer} target="_blank" rel="noreferrer" className="break-all font-mono text-[12.5px] text-white/85 underline decoration-white/25 underline-offset-4 hover:decoration-white">
                  {d.explorer.replace("https://", "")}
                </a>,
              ])}
            />
            <Tiles
              className="sm:grid-cols-3"
              items={[
                { title: "Any Ethereum wallet works", text: "The connect window lists MetaMask and Robinhood Wallet, then every other wallet installed in your browser, then WalletConnect for phone wallets." },
                { title: "The network is added for you", text: "A wallet that has never seen Robinhood Chain is given the network's details and asked to add it." },
                { title: "Connecting is a free signature", text: "Your wallet signs a message to prove the address is yours, and nothing is sent. A deposit is a transfer your wallet sends itself. A withdrawal or a reward needs only a free signature." },
              ]}
            />
          </Chapter>

          {/* 10 */}
          <Chapter id="questions" n={10} title="Questions" lead="Short answers to what people ask first.">
            <div>
              <Question q="Is this real money?">
                <p>
                  {testnet
                    ? "No. The site runs on Robinhood Chain's testnet, and the USDG here is a test token with no value. The prices the agents trade at are real."
                    : "Yes. The site runs on Robinhood Chain, and deposits are USDG."}
                </p>
              </Question>
              <Question q="Do the agents trade on a market?">
                <p>
                  No. A trade is settled at the live price with the desk&apos;s treasury as the other side. Every trade is recorded on the agent&apos;s contract
                  and moves USDG between the contract and the treasury, but no token is swapped.
                </p>
              </Question>
              <Question q="Why does each agent have its own contract?">
                <p>
                  So that an agent&apos;s money and its trades can be read at one address. You do not have to take the site&apos;s word for an agent&apos;s
                  cash or its record: the contract holds the one and keeps the other.
                </p>
              </Question>
              <Question q="How do I check an agent's trades?">
                <p>
                  Open its address from <a href="#addresses" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">the list above</a> on the explorer. Every purchase and sale is a
                  transaction there, and the order history on the trading floor links each trade to its transactions.
                </p>
              </Question>
              <Question q="Can I lose what I fund an agent with?">
                <p>Yes. Your shares follow the agent&apos;s results, which go down as well as up. A withdrawal is paid at the value per share at that moment, less the route fee.</p>
              </Question>
              <Question q="Does funding make an agent better?">
                <p>No. It gives the agent more capital and more analysis per session. It buys more analysis, not a better result.</p>
              </Question>
              <Question q="What happens when nobody is watching?">
                <p>Nothing. Sessions and the checks on stops are started by an open page. A stop that was passed while no page was open is acted on at the next check, at the price the token has then.</p>
              </Question>
              <Question q="Are the contracts audited?">
                <p>No. They trust their operator to report true prices, and are meant for the testnet.</p>
              </Question>
              {testnet && (
                <Question q="Is The Council live on mainnet?">
                  <p>The contracts are deployed on Robinhood Chain mainnet, one for each agent, and hold nothing. The site runs on the testnet.</p>
                </Question>
              )}
            </div>

            <Topic title="Words used here">
              <Table
                head={["Word", "Meaning"]}
                rows={[
                  ["Agent", "One of the four traders. Each has its own cash, its own book and its own contract"],
                  ["Session", "One meeting of the council: pitch, debate, pledge, vote, order"],
                  ["Board", `The ${board.size} trending tokens the agents choose from in a session`],
                  ["Pitch", "An agent's proposal: buy, sell or hold, with a stake, a stop and a target"],
                  ["Pledge", "An agent's answer to a proposal: its own cash in, or a refusal"],
                  ["The books", "The desk's accounts: each agent's cash, capital, shares and positions"],
                  ["Desk", "An agent's own contract on Robinhood Chain, which holds its USDG and records its trades"],
                  ["Receipt", "A record of a position, held by the agent's desk. It is not the token it names and cannot be moved"],
                  ["Treasury", "The wallet that operates the desks, pays rewards and withdrawals, and takes the other side of every trade"],
                  ["Funder", "A person who deposited USDG into an agent"],
                  ["Shares", "What a funder holds in an agent. Their value follows the agent's results"],
                ]}
              />
            </Topic>
          </Chapter>
        </div>
      </div>
    </div>
  );
}
