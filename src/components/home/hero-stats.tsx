"use client";

import { useEffect, useState } from "react";
import { RollingNumber } from "@/components/arena/rolling-number";
import { SHOWCASE, SHOWCASE_EQUITY, SHOWCASE_FUNDED, SHOWCASE_PNL } from "@/lib/showcase";
import { cn, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";

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
  // Sessions that follow one another straight away have nothing to count down to.
  if (left <= 0) return null;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function Stat({ label, children, note, featured }: { label: React.ReactNode; children: React.ReactNode; note?: React.ReactNode; featured?: boolean }) {
  return (
    // On a wide screen the figures stand in one slim row, to leave the screen to the floor.
    <div className={cn("panel flex min-w-0 flex-col justify-between gap-2 px-3.5 py-3.5 sm:px-5 sm:py-4 xl:flex-row xl:items-center xl:justify-start xl:gap-3 xl:px-4 xl:py-2", featured && "panel-strong")}>
      <div className="panel-title xl:shrink-0 xl:text-[10px]">{label}</div>
      <div className="font-display text-xl font-bold leading-none text-white sm:text-3xl xl:min-w-0 xl:truncate xl:text-lg">{children}</div>
      {/* In the slim row there is room for the note only on the widest screens. */}
      <div className="min-h-4 text-[11px] leading-snug text-white/45 sm:truncate sm:text-xs xl:ml-auto xl:hidden xl:min-h-0 xl:text-[11px] min-[1500px]:block">{note}</div>
    </div>
  );
}

/** A panel title with the small tag that says the figure is the demo book's. */
export function DemoTitle({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {children}
      <span className="rounded-sm bg-white/10 px-1 py-px text-[8px] tracking-[0.18em] text-white/50">DEMO</span>
    </span>
  );
}

/** The desk's headline numbers. */
export function HeroStats({ className }: { className?: string }) {
  const ready = useArena((s) => s.ready);
  const portfolio = useArena((s) => s.portfolio);
  const market = useArena((s) => s.desk?.market);
  const round = useArena((s) => s.round);
  const phase = useArena((s) => s.phase);
  const committed = useArena((s) => s.committed);
  const countdown = useCountdown();

  // The desk's figures are the demo book in src/lib/showcase.ts. The trades on the page do not move them.
  const capital = SHOWCASE.capital;
  const equity = SHOWCASE_EQUITY;
  const pnl = SHOWCASE_PNL;
  const pct = (pnl / capital) * 100;
  const funded = SHOWCASE_FUNDED;
  const invested = portfolio.positions.reduce((t, p) => t + p.cost, 0);
  const up = pnl > -0.005;

  return (
    <section className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)} aria-label="Desk summary">
      <Stat label={<DemoTitle>Pool equity</DemoTitle>} featured note={`on $${capital.toFixed(2)} of capital`}>
        {ready ? <RollingNumber value={equity} format={(n) => `$${n.toFixed(2)}`} className="tabular-nums" /> : "…"}
      </Stat>
      <Stat label="Council result" note={market ? "real swaps, at live prices" : "settled at live prices"}>
        <span className={cn("tabular-nums", up ? "text-emerald-400" : "text-red-400")}>
          <RollingNumber value={pnl} format={(n) => fmtSigned(n)} />
          <span className="ml-1.5 text-xs font-semibold opacity-80 sm:ml-2 sm:text-base xl:text-xs">
            {pct >= 0 ? "+" : ""}
            {pct.toFixed(2)}%
          </span>
        </span>
      </Stat>
      <Stat label="Funded by users" note={`$${invested.toFixed(2)} in ${portfolio.positions.length} open position${portfolio.positions.length === 1 ? "" : "s"}`}>
        <RollingNumber value={funded} format={(n) => `$${n.toFixed(2)}`} className="tabular-nums" />
      </Stat>
      <Stat label={`Session ${round || "—"}`} note={phase === "monitor" && countdown ? `next session in ${countdown}` : "in progress"}>
        <span className="flex items-center gap-2 text-[15px] leading-tight sm:gap-2.5 sm:text-2xl xl:text-base">
          <span className={cn("size-2 shrink-0 rounded-full sm:size-2.5", phase === "monitor" ? "bg-white/30" : "animate-pulse bg-white")} />
          <span className="sm:truncate">{phase === "vote" && committed ? JOINING : PHASE[phase]}</span>
        </span>
      </Stat>
    </section>
  );
}
