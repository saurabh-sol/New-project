"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { MIN_HOLD_ROUNDS, unrealized, type Position } from "@/lib/council";
import { SHOWCASE_EQUITY } from "@/lib/showcase";
import { cn, fmtPrice, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { usePrices } from "@/store/selectors";

function heldFor(since: number, now: number) {
  const mins = Math.max(0, Math.floor((now - since) / 60_000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Row({ pos, price, round, now }: { pos: Position; price: number; round: number; now: number }) {
  const pnl = unrealized(pos, price);
  const pct = (pnl / pos.cost) * 100;
  // Where the live price sits between the stop (0) and the target (1).
  const progress = Math.min(Math.max((price - pos.stop) / (pos.target - pos.stop), 0), 1);
  const entryAt = (pos.entryPrice - pos.stop) / (pos.target - pos.stop);
  const locked = round - pos.openedRound < MIN_HOLD_ROUNDS;

  return (
    <motion.li layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }} className="rounded-xl bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold text-white">{pos.token}</span>
          <span className="font-mono text-xs text-white/50">${pos.cost.toFixed(2)}</span>
          {locked && <span className="rounded bg-white/5 px-1.5 py-px text-[9px] uppercase tracking-wider text-white/40">holding</span>}
        </div>
        <div className={cn("font-mono text-sm font-semibold tabular-nums", pnl > -0.005 ? "text-green-400" : "text-red-400")}>
          {fmtSigned(pnl)} <span className="text-xs font-normal opacity-80">({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>
        </div>
      </div>

      <div className="mt-1 flex justify-between font-mono text-[10px] text-white/40">
        <span>in ${fmtPrice(pos.entryPrice)} → now ${fmtPrice(price)}</span>
        <span>held {heldFor(pos.openedAt, now)}</span>
      </div>

      {/* stop ... entry ... target */}
      <div className="relative mt-2 h-1.5 rounded-full bg-gradient-to-r from-white/40 via-white/10 to-white/40">
        <span className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-white/50" style={{ left: `${entryAt * 100}%` }} />
        <motion.span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black bg-white"
          animate={{ left: `${progress * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px]">
        <span className="text-red-300/80">stop ${fmtPrice(pos.stop)}</span>
        <span className="text-white/80">target ${fmtPrice(pos.target)}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {AGENT_ORDER.filter((a) => pos.stake[a] > 0).map((a) => (
          <span key={a} className="rounded-full bg-white/10 px-2 py-px font-mono text-[10px] text-white/70">
            {AGENTS[a].name.replace("The ", "")} ${pos.stake[a].toFixed(0)}
          </span>
        ))}
      </div>
    </motion.li>
  );
}

/** What the desk holds right now, marked to live prices. */
export function Positions({ className }: { className?: string }) {
  const portfolio = useArena((s) => s.portfolio);
  const round = useArena((s) => s.round);
  const prices = usePrices();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className={cn("panel flex min-w-0 flex-col p-4 xl:p-3", className)}>
      <div className="mb-3 flex shrink-0 items-baseline justify-between xl:mb-2">
        <h2 className="panel-title">OPEN POSITIONS</h2>
        <span className="font-mono text-[11px] text-white/40">cash ${(SHOWCASE_EQUITY - portfolio.positions.reduce((t, p) => t + p.cost, 0)).toFixed(2)}</span>
      </div>
      <ul className="min-h-0 space-y-1.5 overflow-y-auto [scrollbar-width:thin]">
        <AnimatePresence initial={false}>
          {portfolio.positions.map((pos) => (
            <Row key={pos.token} pos={pos} price={prices[pos.token] ?? pos.entryPrice} round={round} now={now} />
          ))}
        </AnimatePresence>
      </ul>
      {portfolio.positions.length === 0 && <p className="py-6 text-center text-xs text-white/30">The desk is all in cash.</p>}
    </section>
  );
}
