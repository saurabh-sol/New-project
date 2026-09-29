"use client";

import { AnimatePresence, motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import { explorerLink } from "@/lib/chains";
import type { Fill } from "@/lib/council";
import { cn, fmtPrice, fmtSigned, shortAddress, shortHash } from "@/lib/utils";
import { useArena } from "@/store/arena";

const TRIGGER: Record<Fill["reason"], string> = { COUNCIL: "Council vote", OWN: "Own book", STOP: "Stop-loss", TARGET: "Profit target" };

/**
 * Every trade the desk has made. With a desk contract, each is recorded on Robinhood Chain
 * and links to its transaction. Without one they are paper trades and nothing more.
 */
export function TradeFeed() {
  const fills = useArena((s) => s.fills);
  const desk = useArena((s) => s.desk);
  const columns = desk ? 9 : 8;

  return (
    <section className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-3">
        <h2 className="panel-title">ORDER HISTORY</h2>
        <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-white/80 ring-1 ring-white/30">
          {desk ? "RECORDED ON-CHAIN · SETTLED AT LIVE PRICES · NO MARKET ORDER" : "PAPER TRADING · REAL PRICES · NOT ON-CHAIN"}
        </span>
      </div>
      {desk && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/5 px-4 py-2.5 text-xs text-white/50">
          <span>
            Desk contract{" "}
            <a href={desk.explorerAddress} target="_blank" rel="noreferrer" className="font-mono text-white/80 underline underline-offset-2 hover:text-white">
              {shortAddress(desk.address)} ↗
            </a>{" "}
            on {desk.network}
          </span>
          {desk.holds !== null && <span className="font-mono text-white/70">holds ${desk.holds.toFixed(2)} USDG</span>}
          {desk.solvent === false && <span className="text-red-300">holds less than it owes the agents</span>}
          <span className="text-white/35">The treasury takes the other side of every trade.</span>
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
              {desk && <th className="px-4 py-2 text-right font-normal">Transaction</th>}
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {fills.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-4 py-6 text-center text-white/30">
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
                    initial={{ opacity: 0, backgroundColor: "#80808055" }}
                    animate={{ opacity: 1, backgroundColor: "#80808000" }}
                    transition={{ duration: 1.6 }}
                    className="border-t border-white/5"
                  >
                    <td className="px-4 py-2.5 font-mono text-white/40">{new Date(f.ts).toLocaleTimeString()}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="size-2 rounded-full bg-white/60" />
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
                    {desk && (
                      <td className="px-4 py-2.5 text-right font-mono">
                        {f.tx ? (
                          <a href={explorerLink(desk, f.tx)} target="_blank" rel="noreferrer" className="text-white/80 underline underline-offset-2 hover:text-white">
                            {shortHash(f.tx)} ↗
                          </a>
                        ) : (
                          <span className="text-white/30">{f.unrecorded || f.ts < desk.since ? "not recorded" : "recording…"}</span>
                        )}
                      </td>
                    )}
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
