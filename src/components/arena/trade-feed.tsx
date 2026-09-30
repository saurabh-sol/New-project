"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import type { Fill } from "@/lib/council";
import { inView, setTradeView, tally, useTradeView } from "@/lib/trade-view";
import { hashesOf, isSample, useSampleFills, withSamples } from "@/lib/use-sample-fills";
import { useShowcaseBook } from "@/lib/use-showcase";
import { cn, fmtPrice, fmtSigned, shortAddress, shortHash } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useFreshTrades, useReveal } from "./trade-rows";
import { TradeViewToggle } from "./trade-view-toggle";

const TRIGGER: Record<Fill["reason"], string> = { COUNCIL: "Council vote", OWN: "Own book", STOP: "Stop-loss", TARGET: "Profit target", FALLING: "Sold into a fall" };

const short = (name: string) => name.replace("The ", "");

/** One formatter for the whole table, where toLocaleTimeString would make one per row. */
let clock: Intl.DateTimeFormat | undefined;
const time = (ts: number) => (clock ??= new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })).format(ts);

/**
 * Every trade the desk has made. With desk contracts, each agent's part of a trade is recorded
 * on the agent's own contract on Robinhood Chain, and its hash is shown as text: nothing in the
 * transaction column opens anything. Without them the trades are kept in the desk's books, and each agent's
 * part of a trade is shown with a hash made from the order, as the demo book's are.
 *
 * The sample trades of the demo book (src/lib/showcase.ts) are listed with the desk's own, hashes as text too.
 *
 * A visitor first sees the sales that booked a gain, with a line saying how many closed trades
 * and orders that is out of. "All" shows every one.
 *
 * The table is long (hundreds of orders), so it is kept cheap: the rows are plain and memoized, only a
 * trade that comes in while the page is open is animated (a CSS flash), a switch between the views is
 * rendered as a deferred update in chunks so the toggle answers at once, and the one line that moves
 * with live prices is a component of its own, so a price tick does not touch the rows.
 */
export function TradeFeed() {
  const own = useArena((s) => s.fills);
  const desk = useArena((s) => s.desk);
  const samples = useSampleFills();
  const fills = useMemo(() => withSamples(samples, own), [samples, own]);
  // The toggle shows the choice at once; the table follows when the browser has a moment.
  const view = useDeferredValue(useTradeView());
  const t = useMemo(() => tally(fills), [fills]);
  const shown = useMemo(() => inView(fills, view), [fills, view]);
  const count = useReveal(shown.length, view);
  const fresh = useFreshTrades(fills);
  // Every trade has a transaction to show: from the chain, or made from the order (see hashesOf).
  const withTx = fills.length > 0;
  const columns = withTx ? 9 : 8;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="panel-title">ORDER HISTORY</h2>
          <TradeViewToggle />
        </div>
        <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-white/80 ring-1 ring-white/30">
          {desk?.market ? "REAL SWAPS ON THE MARKET · EACH FROM THE AGENT'S OWN WALLET" : desk ? "RECORDED ON-CHAIN · SETTLED AT LIVE PRICES · NO MARKET ORDER" : "SETTLED AT LIVE PRICES · NOT ON-CHAIN · NO MARKET ORDER"}
        </span>
      </div>
      {view === "gains" && t.orders > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/5 px-4 py-2.5 text-xs text-white/60">
          <span>
            Showing the {t.gains} {t.gains === 1 ? "sale" : "sales"} that closed at a gain, of {t.closed} closed {t.closed === 1 ? "trade" : "trades"} and {t.orders} orders.
          </span>
          <button type="button" onClick={() => setTradeView("all")} className="text-white/85 underline underline-offset-2 hover:text-white">
            Show all, losses included
          </button>
        </p>
      )}
      {desk && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/5 px-4 py-2.5 text-xs text-white/50">
          <span>
            Each agent has a {desk.market ? "wallet" : "desk"} contract of its own on {desk.network}:
          </span>
          {AGENT_ORDER.map((id) => (
            <span key={id}>
              {short(AGENTS[id].name)}{" "}
              <span className="font-mono text-white/80">{shortAddress(desk.agents[id].address)}</span>
            </span>
          ))}
          <Holding market={!!desk.market} />
          {desk.solvent === false && <span className="text-red-300">a contract holds less than it owes its agent</span>}
          <span className="text-white/35">{desk.market ? "Every trade is a swap in the token's pool, and pays its fee." : "The treasury takes the other side of every trade."}</span>
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] whitespace-nowrap text-left text-xs">
          <thead className="font-mono text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-2 font-normal">Time</th>
              <th className="px-4 py-2 font-normal">Led by</th>
              <th className="px-4 py-2 font-normal">Side</th>
              <th className="px-4 py-2 font-normal">Token</th>
              <th className="px-4 py-2 text-right font-normal">Size</th>
              <th className="px-4 py-2 text-right font-normal">Price</th>
              <th className="px-4 py-2 font-normal">Trigger</th>
              <th className="px-4 py-2 text-right font-normal">Realized PnL</th>
              {withTx && <th className="px-4 py-2 text-right font-normal">Transaction</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={columns} className="px-4 py-6 text-center text-white/30">
                  {fills.length === 0 ? "No orders yet. The council only trades when three of four agents agree." : "No trade has closed at a gain yet."}
                </td>
              </tr>
            )}
            {shown.slice(0, count).map((f) => (
              <Row key={f.id} f={f} onChain={!!desk} since={desk?.since} fresh={fresh.has(f.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** What the agents' contracts hold: the one figure on the panel that moves with every price tick. */
function Holding({ market }: { market: boolean }) {
  const book = useShowcaseBook();
  return (
    <span className="font-mono text-white/70">
      holding ${book.equity.toFixed(2)} USDG between them{market ? ", and the tokens they bought" : ""}
    </span>
  );
}

interface RowProps {
  f: Fill;
  /** The desk keeps its trades on contracts. */
  onChain: boolean;
  /** When the desk contracts came into use; an older trade is not on them. */
  since: number | undefined;
  /** The trade came in while the page was open: it flashes once. */
  fresh: boolean;
}

/** One order. Rendered once, and again only when its own trade changes. */
const Row = memo(function Row({ f, onChain, since, fresh }: RowProps) {
  const a = AGENTS[f.leader];
  const others = AGENT_ORDER.filter((id) => id !== f.leader && f.stake[id] >= 0.01);
  // The flash is decided when the row first appears, and not taken back when the list renders again.
  const [flash] = useState(fresh);
  // One hash for each agent in the trade, the leader's first, as in "Led by": from the agent's contract, or made from the order.
  const txs = hashesOf(f);
  const hashes = txs.length > 0 && (
    <span className="flex flex-col items-end gap-0.5">
      {txs.map((t) => (
        <span key={t.agent} className="text-white/60">
          <span className="font-sans text-white/70">{short(AGENTS[t.agent].name)}</span> {shortHash(t.hash)}
        </span>
      ))}
    </span>
  );
  return (
    <tr className={cn("border-t border-white/5", flash && "row-in")}>
      <td className="px-4 py-2.5 font-mono text-white/40">{time(f.ts)}</td>
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-white/60" />
          <span className="text-white/85">{a.name}</span>
        </span>
        {/* who else was in the trade */}
        {others.length > 0 && <span className="mt-0.5 block pl-4 text-[11px] text-white/55">with {others.map((id) => short(AGENTS[id].name)).join(", ")}</span>}
      </td>
      <td className={cn("px-4 py-2.5 font-mono font-bold", f.side === "BUY" ? "text-green-400" : "text-red-400")}>{f.side}</td>
      <td className="px-4 py-2.5 font-mono text-white">{f.token}</td>
      <td className="px-4 py-2.5 text-right font-mono text-white/80">${f.usd.toFixed(2)}</td>
      <td className="px-4 py-2.5 text-right font-mono text-white/60">${fmtPrice(f.price)}</td>
      <td className="px-4 py-2.5 text-white/60">{TRIGGER[f.reason]}</td>
      <td className={cn("px-4 py-2.5 text-right font-mono", f.realized === null ? "text-white/30" : f.realized >= 0 ? "text-green-400" : "text-red-400")}>
        {f.realized === null ? "open" : fmtSigned(f.realized)}
      </td>
      {isSample(f) || !onChain ? (
        <td className="px-4 py-2.5 text-right font-mono">{hashes}</td>
      ) : (
        <td className="px-4 py-2.5 text-right font-mono">
          {f.txs && Object.keys(f.txs).length > 0 ? hashes : f.tx ? <span className="text-white/60">{shortHash(f.tx)}</span> : <span className="text-white/30">{f.unrecorded || (since !== undefined && f.ts < since) ? "not recorded" : "recording…"}</span>}
        </td>
      )}
    </tr>
  );
});
