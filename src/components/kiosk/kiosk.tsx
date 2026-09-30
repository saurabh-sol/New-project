"use client";

import { useEffect, useState } from "react";
import { Floor } from "@/components/arena/arena";
import { Leaderboard } from "@/components/arena/leaderboard";
import { PhaseTimeline } from "@/components/arena/phase-timeline";
import { Positions } from "@/components/arena/positions";
import { RollingNumber } from "@/components/arena/rolling-number";
import { Transcript } from "@/components/arena/transcript";
import { Logo } from "@/components/site/logo";
import { Ticker } from "@/components/site/ticker";
import { BRAND } from "@/lib/brand";
import { poolCapital } from "@/lib/council";
import { cn, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { usePoolEquity } from "@/store/selectors";

const HIDE_CURSOR_AFTER_MS = 3000;

/**
 * Full-screen view for a wall display or a Raspberry Pi: one screen, no scrolling,
 * nothing to click. Effects that need a strong graphics chip are switched off.
 */
export function Kiosk() {
  const mode = useArena((s) => s.mode);
  const portfolio = useArena((s) => s.portfolio);
  const equity = usePoolEquity();
  const pnl = equity - poolCapital(portfolio);
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("lite");
    return () => document.documentElement.classList.remove("lite");
  }, []);

  useEffect(() => {
    let timer = setTimeout(() => setIdle(true), HIDE_CURSOR_AFTER_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), HIDE_CURSOR_AFTER_MS);
    };
    window.addEventListener("mousemove", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousemove", wake);
    };
  }, []);

  return (
    <div className={cn("flex h-dvh w-screen flex-col overflow-hidden bg-black", idle && "cursor-none")}>
      <header className="flex shrink-0 items-center gap-4 px-5 py-2.5">
        <Logo className="size-10" />
        <div className="leading-none">
          <div className="font-display text-xl font-bold text-white">{BRAND}</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">AI trading desk</div>
        </div>
        <div className="ml-6 min-w-0 flex-1">
          <PhaseTimeline />
        </div>
        <div className="text-right leading-none">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">Pool equity</div>
          <RollingNumber value={equity} format={(n) => `$${n.toFixed(2)}`} className="font-display text-2xl font-bold tabular-nums text-white" />
        </div>
        <div className="text-right leading-none">
          <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">Result</div>
          <RollingNumber
            value={pnl}
            format={(n) => fmtSigned(n)}
            className={cn("font-display text-2xl font-bold tabular-nums", pnl > -0.005 ? "text-emerald-400" : "text-red-400")}
          />
        </div>
        <span
          className={cn(
            "rounded-full border px-3 py-1 font-mono text-[10px] tracking-wider",
            mode === "live" ? "border-white/30 bg-white/10 text-white/80" : "border-white/30 bg-white/10 text-white/80",
          )}
        >
          {mode === "live" ? "LIVE AI MODELS" : "SCRIPTED AGENTS"} · LIVE PRICES
        </span>
      </header>

      <Ticker />

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,26vw)] gap-3 p-3">
        {/* The floor keeps its 16:11 shape and takes whatever height is left. */}
        <div className="flex min-h-0 items-center justify-center">
          <Floor className="!aspect-[16/11] h-full max-h-full !w-auto max-w-full" />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <Leaderboard />
          <div className="min-h-0 flex-1 [&>section]:h-full">
            <Transcript className="min-h-0 flex-1" />
          </div>
          <div className="max-h-[30%] shrink-0 overflow-hidden">
            <Positions />
          </div>
        </div>
      </main>
    </div>
  );
}
