"use client";

import { motion } from "motion/react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { cn, fmtSigned, MIN_SPARK_SPAN } from "@/lib/utils";
import { agentPnl } from "@/lib/council";
import type { AgentId } from "@/lib/types";
import { useArena } from "@/store/arena";
import { useModelName, usePrices } from "@/store/selectors";
import { Face } from "./face";
import { RollingNumber } from "./rolling-number";

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="h-6 w-12" />;
  const mid = (Math.min(...data, 0) + Math.max(...data, 0)) / 2;
  const span = Math.max(Math.max(...data, 0) - Math.min(...data, 0), MIN_SPARK_SPAN);
  const min = mid - span / 2;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 64},${24 - ((v - min) / span) * 22 - 1}`).join(" ");
  const zeroY = 24 - ((0 - min) / span) * 22 - 1;
  return (
    <svg viewBox="0 0 64 24" preserveAspectRatio="none" className="h-6 w-12 shrink-0">
      <line x1="0" x2="64" y1={zeroY} y2={zeroY} stroke="#ffffff15" strokeDasharray="2 2" />
      <motion.polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        initial={false}
        animate={{ points: pts }}
      />
    </svg>
  );
}

function Row({ id, rank, pnl, history }: { id: AgentId; rank: number; pnl: number; history: number[] }) {
  const a = AGENTS[id];
  const model = useModelName(id);
  return (
    <motion.li layout transition={{ type: "spring", stiffness: 300, damping: 28 }} className="flex items-center gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
      <span className="w-4 font-mono text-xs text-white/40">{rank}</span>
      <Face id={id} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-white">{a.name}</div>
        <div className="truncate text-[10px] uppercase tracking-wider text-white/40">{model}</div>
      </div>
      <Sparkline data={history} color={pnl > -0.005 ? "#4ade80" : "#f87171"} />
      <RollingNumber
        value={pnl}
        format={(n) => fmtSigned(n)}
        className={cn("w-[4.5rem] shrink-0 text-right font-mono text-sm font-semibold tabular-nums", pnl > -0.005 ? "text-green-400" : "text-red-400")}
      />
    </motion.li>
  );
}

export function Leaderboard() {
  const agents = useArena((s) => s.agents);
  const portfolio = useArena((s) => s.portfolio);
  const prices = usePrices();
  const pnl = Object.fromEntries(AGENT_ORDER.map((id) => [id, agentPnl(portfolio, id, prices)])) as Record<AgentId, number>;
  const ranked = [...AGENT_ORDER].sort((a, b) => pnl[b] - pnl[a]);
  const total = AGENT_ORDER.reduce((sum, id) => sum + pnl[id], 0);

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="panel-title">LEADERBOARD</h2>
          <p className="mt-1 text-[11px] text-white/35">Result on each agent&apos;s capital</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-white/40">Council PnL</div>
          <RollingNumber
            value={total}
            format={(n) => fmtSigned(n)}
            className={cn("font-mono text-lg font-bold", total > -0.005 ? "text-green-400" : "text-red-400")}
          />
        </div>
      </div>
      <ol className="space-y-1.5">
        {ranked.map((id, i) => (
          <Row key={id} id={id} rank={i + 1} pnl={pnl[id]} history={agents[id].history} />
        ))}
      </ol>
    </section>
  );
}
