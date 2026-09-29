"use client";

import { useEffect, useState } from "react";
import { RollingNumber } from "@/components/arena/rolling-number";
import { AGENT_ORDER } from "@/lib/agents";
import { poolCapital, userFunding } from "@/lib/council";
import { cn, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { usePoolEquity } from "@/store/selectors";

/** In a session that carries out a funder's commitment nobody votes: the agents join or stay out. */
const JOINING = "Who joins";

const PHASE: Record<string, string> = {
  monitor: "Watching positions",
  scan: "Reading the market",
  pitch: "Agents pitching",
  debate: "Debating",
  negotiate: "Committing capital",
  vote: "Voting",
  execute: "Sending the order",
  settle: "Closing the session",
};

function useCountdown(): string | null {
  const nextRoundAt = useArena((s) => s.nextRoundAt);
  const skew = useArena((s) => s.clockSkew);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!nextRoundAt) return null;
  const left = Math.max(0, Math.round((nextRoundAt - (now + skew)) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function Stat({ label, children, note, featured }: { label: string; children: React.ReactNode; note?: React.ReactNode; featured?: boolean }) {
  return (
    <div className={cn("panel flex min-w-0 flex-col justify-between gap-2 px-3.5 py-3.5 sm:px-5 sm:py-4", featured && "panel-strong")}>
      <div className="panel-title">{label}</div>
      <div className="font-display text-xl font-bold leading-none text-white sm:text-3xl">{children}</div>
      <div className="min-h-4 text-[11px] leading-snug text-white/45 sm:truncate sm:text-xs">{note}</div>
    </div>
  );
}

/** The desk's headline numbers. */
export function HeroStats() {
  const ready = useArena((s) => s.ready);
  const portfolio = useArena((s) => s.portfolio);
  const round = useArena((s) => s.round);
  const phase = useArena((s) => s.phase);
  const committed = useArena((s) => s.committed);
  const equity = usePoolEquity();
  const countdown = useCountdown();

  const capital = poolCapital(portfolio);
  const pnl = equity - capital;
  const pct = capital > 0 ? (pnl / capital) * 100 : 0;
  const funded = AGENT_ORDER.reduce((t, a) => t + userFunding(portfolio, a), 0);
  const invested = portfolio.positions.reduce((t, p) => t + p.cost, 0);
  const up = pnl > -0.005;

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Desk summary">
      <Stat label="Pool equity" featured note={`on $${capital.toFixed(2)} of capital`}>
        {ready ? <RollingNumber value={equity} format={(n) => `$${n.toFixed(2)}`} className="tabular-nums" /> : "…"}
      </Stat>
      <Stat label="Council result" note="paper trades at live prices">
        <span className={cn("tabular-nums", up ? "text-emerald-400" : "text-red-400")}>
          <RollingNumber value={pnl} format={(n) => fmtSigned(n)} />
          <span className="ml-1.5 text-xs font-semibold opacity-80 sm:ml-2 sm:text-base">
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </span>
        </span>
      </Stat>
      <Stat label="Funded by users" note={`$${invested.toFixed(2)} in ${portfolio.positions.length} open position${portfolio.positions.length === 1 ? "" : "s"}`}>
        <RollingNumber value={funded} format={(n) => `$${n.toFixed(2)}`} className="tabular-nums" />
      </Stat>
      <Stat label={`Session ${round || "—"}`} note={phase === "monitor" && countdown ? `next session in ${countdown}` : "in progress"}>
        <span className="flex items-center gap-2 text-[15px] leading-tight sm:gap-2.5 sm:text-2xl">
          <span className={cn("size-2 shrink-0 rounded-full sm:size-2.5", phase === "monitor" ? "bg-white/30" : "animate-pulse bg-white")} />
          <span className="sm:truncate">{phase === "vote" && committed ? JOINING : PHASE[phase]}</span>
        </span>
      </Stat>
    </section>
  );
}
