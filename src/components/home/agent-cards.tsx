"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { Character } from "@/components/arena/character";
import { RollingNumber } from "@/components/arena/rolling-number";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { agentNav, agentPnl, userFunding } from "@/lib/council";
import type { AgentFunding } from "@/lib/funding-types";
import type { AgentId, AgentState } from "@/lib/types";
import { useFundStatus } from "@/lib/use-fund";
import { cn, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useModelName, usePrices } from "@/store/selectors";

const DOING: Record<AgentState, string> = {
  idle: "At the desk",
  thinking: "Analysing",
  speaking: "Speaking",
  negotiating: "Committing capital",
  voting: "Voting",
  executing: "Sending the order",
  win: "Booked a gain",
  loss: "Booked a loss",
};

function Card({ id, rank, funding, canFund }: { id: AgentId; rank: number; funding: AgentFunding | undefined; canFund: boolean }) {
  const a = AGENTS[id];
  const model = useModelName(id);
  const rt = useArena((s) => s.agents[id]);
  const portfolio = useArena((s) => s.portfolio);
  const prices = usePrices();

  const pnl = agentPnl(portfolio, id, prices);
  const pct = (agentNav(portfolio, id, prices) - 1) * 100;
  const funded = funding?.fundedUsd ?? userFunding(portfolio, id);
  const inTrades = portfolio.positions.reduce((t, p) => t + p.stake[id], 0);
  const up = pnl > -0.005;
  const toNext = funding?.nextLevelAt ? Math.min(funded / funding.nextLevelAt, 1) : 1;
  const level = funding?.levelLabel ?? "Standard analysis";

  return (
    <motion.article
      layout
      className="panel flex min-w-0 flex-1 flex-col justify-between gap-2 px-3 py-2.5"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 24 }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 shrink-0">
          <Character id={id} pose={rt.state === "win" ? "cheer" : rt.state === "loss" ? "slump" : rt.state === "speaking" ? "talk" : "idle"} emotion={rt.emotion} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="font-display truncate text-[15px] font-semibold leading-tight text-white">{a.name}</h3>
            <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[10px] text-white/60">#{rank}</span>
          </div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-white/50">
            <span className={cn("size-1.5 shrink-0 rounded-full", rt.state === "idle" ? "bg-white/30" : "animate-pulse bg-white")} />
            <span className="truncate">
              <span className="font-mono text-[10px] uppercase tracking-wider text-white/60">{model}</span> · {DOING[rt.state]}
            </span>
          </div>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/5 bg-white/5">
        <div className="bg-black px-2.5 py-1">
          <dt className="text-[9px] uppercase tracking-widest text-white/40">Result</dt>
          <dd className={cn("font-mono text-[13px] font-semibold tabular-nums", up ? "text-emerald-400" : "text-red-400")}>
            <RollingNumber value={pnl} format={(n) => fmtSigned(n)} />
            <span className="ml-1 text-[10px] font-normal opacity-75">
              {pct >= 0 ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          </dd>
        </div>
        <div className="bg-black px-2.5 py-1">
          <dt className="text-[9px] uppercase tracking-widest text-white/40">In trades</dt>
          <dd className="font-mono text-[13px] font-semibold tabular-nums text-white">${inTrades.toFixed(2)}</dd>
        </div>
      </dl>

      <div className="flex items-center gap-2.5">
        <div className="min-w-0 flex-1" title={funding?.nextLevelAt ? `$${Math.max(funding.nextLevelAt - funded, 0).toFixed(0)} more unlocks the next analysis level` : "Top analysis level"}>
          <div className="truncate text-[11px] text-white/50">
            {level} · <span className="font-mono text-white/70">${funded.toFixed(0)}</span> funded
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10" role="presentation">
            <motion.div className="h-full rounded-full bg-white" animate={{ width: `${Math.max(toNext * 100, 3)}%` }} transition={{ type: "spring", stiffness: 80, damping: 18 }} />
          </div>
        </div>
        <Link href={`/fund?agent=${id}`} className={cn("shrink-0 px-3 py-1 text-xs", canFund ? "btn-primary" : "btn-ghost")}>
          {canFund ? "Fund" : "Funding"}
        </Link>
      </div>
    </motion.article>
  );
}

/** One card per agent, ranked by result. `className` lays the cards out: a column beside the floor, a grid elsewhere. */
export function AgentCards({ className }: { className?: string }) {
  const portfolio = useArena((s) => s.portfolio);
  const prices = usePrices();
  const { status } = useFundStatus(null);
  const ranked = [...AGENT_ORDER].sort((x, y) => agentPnl(portfolio, y, prices) - agentPnl(portfolio, x, prices));

  return (
    <section aria-label="The agents" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-col">
        {ranked.map((id, i) => (
          <Card key={id} id={id} rank={i + 1} funding={status?.agents.find((f) => f.agent === id)} canFund={!!status?.chain.enabled} />
        ))}
      </div>
      <p className="px-1 text-[11px] leading-snug text-white/40">Funding gives an agent more capital and more thinking time. It does not guarantee a better result.</p>
    </section>
  );
}
