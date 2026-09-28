"use client";

import { AnimatePresence, motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import type { Fill } from "@/lib/council";
import { cn, fmtPrice, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";

const TRIGGER: Record<Fill["reason"], string> = { COUNCIL: "Council vote", STOP: "Stop-loss", TARGET: "Profit target" };

/** Every order the desk has placed. These are paper trades, so there is no on-chain transaction to link. */
export function TradeFeed() {
  const fills = useArena((s) => s.fills);

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
        <h2 className="panel-title">ORDER HISTORY</h2>
        <span className="rounded bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-amber-300 ring-1 ring-amber-400/30">
          PAPER TRADING · REAL PRICES · NOT ON-CHAIN
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
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
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {fills.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-white/30">
                    No orders yet. The council only trades when three of four agents agree.
                  </td>
                </tr>
              )}
              {fills.map((f) => {
                const a = AGENTS[f.leader];
                return (
                  <motion.tr
                    key={f.id}
                    layout
                    initial={{ opacity: 0, backgroundColor: `${a.color}40` }}
                    animate={{ opacity: 1, backgroundColor: "#00000000" }}
                    transition={{ duration: 1.6 }}
                    className="border-t border-white/5"
                  >
                    <td className="px-4 py-2.5 font-mono text-white/40">{new Date(f.ts).toLocaleTimeString()}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full" style={{ background: a.color }} />
                        <span className="text-white/85">{a.name}</span>
                      </span>
                    </td>
                    <td className={cn("px-4 py-2.5 font-mono font-bold", f.side === "BUY" ? "text-green-400" : "text-red-400")}>{f.side}</td>
                    <td className="px-4 py-2.5 font-mono text-white">{f.token}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-white/80">${f.usd.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-white/60">${fmtPrice(f.price)}</td>
                    <td className="px-4 py-2.5 text-white/60">{TRIGGER[f.reason]}</td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right font-mono",
                        f.realized === null ? "text-white/30" : f.realized >= 0 ? "text-green-400" : "text-red-400",
                      )}
                    >
                      {f.realized === null ? "open" : fmtSigned(f.realized)}
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </section>
  );
}
