"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { explorerLink } from "@/lib/chains";
import type { Fill } from "@/lib/council";
import { DEPLOYED } from "@/lib/deployments";
import { inView, tally, useTradeView } from "@/lib/trade-view";
import { hashesOf, isSample, useSampleFills, withSamples } from "@/lib/use-sample-fills";
import { cn, fmtPrice, fmtSigned, shortHash } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useFreshTrades } from "./trade-rows";
import { TradeViewToggle } from "./trade-view-toggle";

const WHY: Record<Fill["reason"], string> = { COUNCIL: "council vote", OWN: "own book", STOP: "stop-loss", TARGET: "profit target", FALLING: "sold into a fall" };
const short = (name: string) => name.replace("The ", "");
/** One formatter for the whole list, where toLocaleTimeString would make one per line. */
let clock: Intl.DateTimeFormat | undefined;
const time = (ts: number) => (clock ??= new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })).format(ts);

/** Where a trade recorded on Robinhood Chain can be seen, when the desk's contracts are no longer in the page's state. */
const MAINNET_TX = `${DEPLOYED.mainnet.explorer}/tx/{id}`;

/** A trade the desk recorded on the chain: its hashes are real, and open on the explorer. A made-up hash opens nothing. */
const recorded = (f: Fill) => !isSample(f) && ((!!f.txs && Object.keys(f.txs).length > 0) || !!f.tx);

/** Who was in the trade: the one agent, or the leader and how many joined. */
function who(f: Fill): string {
  const parties = AGENT_ORDER.filter((a) => f.stake[a] >= 0.01);
  if (parties.length <= 1) return short(AGENTS[parties[0] ?? f.leader].name);
  return `${short(AGENTS[f.leader].name)} +${parties.length - 1}`;
}

/**
 * The latest trades, newest first, each with its transactions. The full order history is further down the page.
 * The sample trades of the demo book (src/lib/showcase.ts) are listed with the desk's own; their hashes are text, and open nothing.
 * Without desk contracts the desk's own trades are shown the same way, a hash per agent made from the order (hashesOf).
 * A visitor first sees the sales that booked a gain. The line under the title says how many of the
 * closed trades that is, and "All" shows the rest.
 *
 * The lines are plain and memoized; only a trade that comes in while the page is open slides in.
 */
export function RecentTrades({ className }: { className?: string }) {
  const own = useArena((s) => s.fills);
  const desk = useArena((s) => s.desk);
  const samples = useSampleFills();
  const fills = useMemo(() => withSamples(samples, own), [samples, own]);
  // The toggle shows the choice at once; the list follows when the browser has a moment.
  const view = useDeferredValue(useTradeView());
  const t = useMemo(() => tally(fills), [fills]);
  const latest = useMemo(() => inView(fills, view).slice(0, 30), [fills, view]);
  const fresh = useFreshTrades(fills);

  return (
    <section className={cn("panel flex min-w-0 flex-col", className)}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 px-4 py-2">
        <h2 className="panel-title truncate">{view === "gains" ? "Winning trades" : "Recent trades"}</h2>
        <TradeViewToggle />
      </div>
      <p className="flex shrink-0 items-baseline justify-between gap-2 border-b border-white/5 px-4 py-1.5 font-mono text-[10px] uppercase tracking-widest text-white/40">
        <span className="truncate">{view === "gains" ? `${t.gains} of ${t.closed} closed trades` : `${t.orders} orders · ${t.gains} gains · ${t.losses} losses`}</span>
        <span className="shrink-0">{desk ? "on-chain" : "off-chain"}</span>
      </p>
      <ul className="max-h-80 min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto [scrollbar-width:thin] xl:max-h-none">
        {latest.length === 0 && (
          <li className="px-4 py-6 text-center text-xs text-white/30">{view === "gains" && t.orders > 0 ? "No trade has closed at a gain yet." : "No trades yet."}</li>
        )}
        {latest.map((f) => (
          <Line key={f.id} f={f} onChain={!!desk} since={desk?.since} explorerTx={desk?.explorerTx ?? MAINNET_TX} fresh={fresh.has(f.id)} />
        ))}
      </ul>
    </section>
  );
}

interface LineProps {
  f: Fill;
  /** The desk keeps its trades on contracts. */
  onChain: boolean;
  /** When the desk contracts came into use; an older trade is not on them. */
  since: number | undefined;
  /** The explorer's page for a transaction, with "{id}" for the hash. */
  explorerTx: string;
  /** The trade came in while the page was open: it slides in once. */
  fresh: boolean;
}

/** One trade. Rendered once, and again only when its own trade changes. */
const Line = memo(function Line({ f, onChain, since, explorerTx, fresh }: LineProps) {
  // Decided when the line first appears, and not taken back when the list renders again.
  const [slide] = useState(fresh);
  // A hash for each agent in the trade: from the agent's contract, or made from the order.
  const txs = hashesOf(f);
  // A trade the desk recorded on the chain links to the explorer, so a visitor can see it there.
  const linked = recorded(f);
  const hashes = txs.map((t) =>
    linked ? (
      <a key={t.agent} href={explorerLink({ explorerTx }, t.hash)} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-white">
        {txs.length > 1 ? `${short(AGENTS[t.agent].name)} ` : ""}
        {shortHash(t.hash)} ↗
      </a>
    ) : (
      <span key={t.agent}>
        {txs.length > 1 ? `${short(AGENTS[t.agent].name)} ` : ""}
        {shortHash(t.hash)}
      </span>
    ),
  );
  return (
    <li className={cn("px-4 py-2 text-xs", slide && "item-in")}>
      <div className="flex items-baseline gap-2">
        <span className={cn("rounded px-1.5 py-px font-mono text-[10px] font-bold", f.side === "BUY" ? "bg-white/10 text-green-400" : "bg-white/10 text-red-400")}>{f.side}</span>
        <span className="truncate font-mono font-semibold text-white">{f.token}</span>
        <span className="font-mono text-white/60">${f.usd.toFixed(2)}</span>
        <span className={cn("ml-auto shrink-0 font-mono", f.realized === null ? "text-white/30" : f.realized >= 0 ? "text-green-400" : "text-red-400")}>
          {f.realized === null ? "open" : fmtSigned(f.realized)}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-2 text-[11px] text-white/45">
        <span className="font-mono">{time(f.ts)}</span>
        <span className="truncate">
          {who(f)} · {WHY[f.reason]} · at ${fmtPrice(f.price)}
        </span>
      </div>
      {isSample(f) || !onChain ? (
        <div className="mt-0.5 flex flex-wrap gap-x-2.5 font-mono text-[10px] text-white/35">{hashes}</div>
      ) : (
        <div className="mt-0.5 flex flex-wrap gap-x-2.5 font-mono text-[10px] text-white/35">
          {f.txs && Object.keys(f.txs).length > 0 ? hashes : f.tx ? hashes : f.unrecorded || (since !== undefined && f.ts < since) ? "not recorded on-chain" : "recording…"}
        </div>
      )}
    </li>
  );
});
