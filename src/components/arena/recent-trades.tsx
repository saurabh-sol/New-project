"use client";

import { AnimatePresence, motion } from "motion/react";
import { AGENTS, AGENT_ORDER, leaderFirst } from "@/lib/agents";
import { explorerLink } from "@/lib/chains";
import type { Fill } from "@/lib/council";
import { inView, tally, useTradeView } from "@/lib/trade-view";
import { isSample, useSampleFills, withSamples } from "@/lib/use-sample-fills";
import { cn, fmtPrice, fmtSigned, shortHash } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { TradeViewToggle } from "./trade-view-toggle";

const WHY: Record<Fill["reason"], string> = { COUNCIL: "council vote", OWN: "own book", STOP: "stop-loss", TARGET: "profit target", FALLING: "sold into a fall" };
const short = (name: string) => name.replace("The ", "");
const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Who was in the trade: the one agent, or the leader and how many joined. */
function who(f: Fill): string {
  const parties = AGENT_ORDER.filter((a) => f.stake[a] >= 0.01);
  if (parties.length <= 1) return short(AGENTS[parties[0] ?? f.leader].name);
  return `${short(AGENTS[f.leader].name)} +${parties.length - 1}`;
}

/**
 * The latest trades, newest first, each with its transactions. The full order history is further down the page.
 * The sample trades of the demo book (src/lib/showcase.ts) are listed with the desk's own; their hashes are text, and open nothing.
 * A visitor first sees the sales that booked a gain. The line under the title says how many of the
 * closed trades that is, and "All" shows the rest.
 */
export function RecentTrades({ className }: { className?: string }) {
  const own = useArena((s) => s.fills);
  const desk = useArena((s) => s.desk);
  const samples = useSampleFills();
  const fills = withSamples(samples, own);
  const view = useTradeView();
  const t = tally(fills);
  const latest = inView(fills, view).slice(0, 30);

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
        <AnimatePresence initial={false}>
          {latest.map((f) => {
            const txs = f.txs && Object.keys(f.txs).length ? leaderFirst(f.leader).flatMap((a) => (f.txs?.[a] ? [{ agent: a, hash: f.txs[a]! }] : [])) : f.tx ? [{ agent: f.leader, hash: f.tx }] : [];
            return (
              <motion.li key={f.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="px-4 py-2 text-xs">
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
                {isSample(f) ? (
                  <div className="mt-0.5 flex flex-wrap gap-x-2.5 font-mono text-[10px] text-white/35">
                    {txs.map((t) => (
                      <span key={t.agent}>
                        {txs.length > 1 ? `${short(AGENTS[t.agent].name)} ` : ""}
                        {shortHash(t.hash)}
                      </span>
                    ))}
                  </div>
                ) : (
                  desk && (
                    <div className="mt-0.5 flex flex-wrap gap-x-2.5 font-mono text-[10px] text-white/35">
                      {txs.length > 0
                        ? txs.map((t) => (
                            <a key={t.agent} href={explorerLink(desk, t.hash)} target="_blank" rel="noreferrer" className="pointer-events-auto underline underline-offset-2 hover:text-white">
                              {txs.length > 1 ? `${short(AGENTS[t.agent].name)} ` : ""}
                              {shortHash(t.hash)} ↗
                            </a>
                          ))
                        : f.unrecorded || f.ts < desk.since
                          ? "not recorded on-chain"
                          : "recording…"}
                    </div>
                  )
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
