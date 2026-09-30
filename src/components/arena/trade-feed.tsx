"use client";

import { AnimatePresence, motion } from "motion/react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { explorerLink } from "@/lib/chains";
import type { Fill } from "@/lib/council";
import { inView, setTradeView, tally, useTradeView } from "@/lib/trade-view";
import { isSample, useSampleFills, withSamples } from "@/lib/use-sample-fills";
import { useShowcaseBook } from "@/lib/use-showcase";
import { cn, fmtPrice, fmtSigned, shortAddress, shortHash } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { TradeViewToggle } from "./trade-view-toggle";

const TRIGGER: Record<Fill["reason"], string> = { COUNCIL: "Council vote", OWN: "Own book", STOP: "Stop-loss", TARGET: "Profit target", FALLING: "Sold into a fall" };

const short = (name: string) => name.replace("The ", "");

/**
 * Every trade the desk has made. With desk contracts, each agent's part of a trade is recorded
 * on the agent's own contract on Robinhood Chain, and links to its transaction. Without them
 * they are kept in the desk's books and nowhere else.
 *
 * The sample trades of the demo book (src/lib/showcase.ts) are listed with the desk's own; their hashes are text, and open nothing.
 *
 * A visitor first sees the sales that booked a gain, with a line saying how many closed trades
 * and orders that is out of. "All" shows every one.
 */
export function TradeFeed() {
  const own = useArena((s) => s.fills);
  const desk = useArena((s) => s.desk);
  const samples = useSampleFills();
  const book = useShowcaseBook();
  const fills = withSamples(samples, own);
  const view = useTradeView();
  const t = tally(fills);
  const shown = inView(fills, view);
  // The transaction column is there once any trade has one to show.
  const withTx = !!desk || samples.length > 0;
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
              <a href={desk.agents[id].explorerAddress} target="_blank" rel="noreferrer" className="font-mono text-white/80 underline underline-offset-2 hover:text-white">
                {shortAddress(desk.agents[id].address)} ↗
              </a>
            </span>
          ))}
          <span className="font-mono text-white/70">
            holding ${book.equity.toFixed(2)} USDG between them{desk.market ? ", and the tokens they bought" : ""}
          </span>
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
            <AnimatePresence initial={false}>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-4 py-6 text-center text-white/30">
                    {fills.length === 0 ? "No orders yet. The council only trades when three of four agents agree." : "No trade has closed at a gain yet."}
                  </td>
                </tr>
              )}
              {shown.map((f) => {
                const a = AGENTS[f.leader];
                const others = AGENT_ORDER.filter((id) => id !== f.leader && f.stake[id] >= 0.01);
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
                      {/* who else was in the trade */}
                      {others.length > 0 && <span className="mt-0.5 block pl-4 text-[11px] text-white/55">with {others.map((id) => short(AGENTS[id].name)).join(", ")}</span>}
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
                    {isSample(f) ? (
                      <td className="px-4 py-2.5 text-right font-mono">
                        <span className="flex flex-col items-end gap-0.5">
                          {AGENT_ORDER.filter((id) => f.txs?.[id]).map((id) => (
                            <span key={id} className="text-white/60">
                              <span className="font-sans text-white/70">{short(AGENTS[id].name)}</span> {shortHash(f.txs![id]!)}
                            </span>
                          ))}
                        </span>
                      </td>
                    ) : !desk ? (
                      withTx && <td className="px-4 py-2.5 text-right font-mono text-white/30">—</td>
                    ) : (
                      <td className="px-4 py-2.5 text-right font-mono">
                        {f.txs && Object.keys(f.txs).length > 0 ? (
                          // One transaction for each agent in the trade, on that agent's contract.
                          <span className="flex flex-col items-end gap-0.5">
                            {AGENT_ORDER.filter((id) => f.txs?.[id]).map((id) => (
                              <a key={id} href={explorerLink(desk, f.txs![id]!)} target="_blank" rel="noreferrer" className="text-white/80 underline underline-offset-2 hover:text-white">
                                <span className="font-sans text-white/70 no-underline">{short(AGENTS[id].name)}</span> {shortHash(f.txs![id]!)} ↗
                              </a>
                            ))}
                          </span>
                        ) : f.tx ? (
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
