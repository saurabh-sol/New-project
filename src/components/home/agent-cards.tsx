"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { Character } from "@/components/arena/character";
import { RollingNumber } from "@/components/arena/rolling-number";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import type { AgentFunding } from "@/lib/funding-types";
import type { AgentId, AgentState } from "@/lib/types";
import { SHOWCASE, SHOWCASE_AGENT_CAPITAL, showcasePct, showcaseResult } from "@/lib/showcase";
import { useFundStatus } from "@/lib/use-fund";
import { cn, fmtSigned, shortAddress } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useModelName } from "@/store/selectors";

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
  const desk = useArena((s) => s.desk?.agents[id]);

  // The agent's result, its funding and what its desk holds are the demo book's (src/lib/showcase.ts).
  const pnl = showcaseResult(id);
  const pct = showcasePct(id);
  const funded = SHOWCASE.funded[id];
  const holds = SHOWCASE_AGENT_CAPITAL + pnl;
  const inTrades = portfolio.positions.reduce((t, p) => t + p.stake[id], 0);
  const up = pnl > -0.005;
  const toNext = funding?.nextLevelAt ? Math.min(funded / funding.nextLevelAt, 1) : 1;
  const level = funding?.levelLabel ?? "Standard analysis";

  return (
    <motion.article
      layout
      className="panel flex min-w-0 flex-col justify-center gap-2 px-3 py-2.5 xl:min-h-0 xl:flex-1 xl:gap-1.5 xl:py-2"
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
        {/* the agent's own result */}
        <div className={cn("shrink-0 text-right font-mono tabular-nums leading-tight", up ? "text-emerald-400" : "text-red-400")}>
          <div className="text-sm font-semibold">
            <RollingNumber value={pnl} format={(n) => fmtSigned(n)} />
          </div>
          <div className="text-[10px] opacity-75">
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 text-[11px]" title={funding?.nextLevelAt ? `${level}. $${Math.max(funding.nextLevelAt - funded, 0).toFixed(0)} more unlocks the next analysis level` : `${level}. Top analysis level`}>
          <div className="min-w-0">
            <dt className="text-[9px] uppercase tracking-widest text-white/40">In trades</dt>
            <dd className="truncate font-mono font-semibold tabular-nums text-white">${inTrades.toFixed(2)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[9px] uppercase tracking-widest text-white/40">Funded</dt>
            <dd className="truncate font-mono font-semibold tabular-nums text-white">${funded.toFixed(0)}</dd>
          </div>
          <div className="col-span-2 mt-1 h-1 overflow-hidden rounded-full bg-white/10" role="presentation">
            <motion.div className="h-full rounded-full bg-white" animate={{ width: `${Math.max(toNext * 100, 3)}%` }} transition={{ type: "spring", stiffness: 80, damping: 18 }} />
          </div>
        </dl>
        <Link href={`/fund?agent=${id}`} className={cn("shrink-0 px-3 py-1 text-xs", canFund ? "btn-primary" : "btn-ghost")}>
          {canFund ? "Fund" : "Funding"}
        </Link>
      </div>

      {/* The agent's own contract, where its money is held and its trades are on record. */}
      {desk && (
        <a href={desk.explorerAddress} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 text-[11px] leading-none text-white/50 hover:text-white">
          <span className="truncate">
            On-chain desk <span className="font-mono text-white/80 underline underline-offset-2">{shortAddress(desk.address)} ↗</span>
          </span>
          <span className="shrink-0 font-mono text-white/60">${holds.toFixed(2)}</span>
        </a>
      )}
    </motion.article>
  );
}

/** One card per agent, ranked by result. `className` lays the cards out: a column beside the floor, a grid elsewhere. */
export function AgentCards({ className }: { className?: string }) {
  const { status } = useFundStatus(null);
  const ranked = [...AGENT_ORDER].sort((x, y) => showcaseResult(y) - showcaseResult(x));

  return (
    <section aria-label="The agents" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:flex xl:flex-col xl:gap-2">
        {ranked.map((id, i) => (
          <Card key={id} id={id} rank={i + 1} funding={status?.agents.find((f) => f.agent === id)} canFund={!!status?.chain.enabled} />
        ))}
      </div>
      {/* On a wide screen this is said in the footer, to leave the room to the desk. */}
      <p className="px-1 text-[11px] leading-snug text-white/40 xl:hidden">Funding gives an agent more capital and more thinking time. It does not guarantee a better result.</p>
    </section>
  );
}
