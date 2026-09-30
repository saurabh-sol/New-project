"use client";

import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/admin/actions";
import { Floor } from "@/components/arena/arena";
import { Logo } from "@/components/site/logo";
import { Ticker } from "@/components/site/ticker";
import { BRAND } from "@/lib/brand";
import type { Phase } from "@/lib/types";
import { useShowcaseBook } from "@/lib/use-showcase";
import { cn, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { AgentsStrip, PositionsPane, SystemPane } from "./panes";
import { TradeLog } from "./trade-log";
import { useAdminStatus, useNow } from "./use-status";

const HIDE_CURSOR_AFTER_MS = 3000;
/** A display left on for weeks loads the page afresh this often, between sessions. */
const RELOAD_AFTER_MS = 6 * 60 * 60 * 1000;

const PHASES: Phase[] = ["monitor", "scan", "pitch", "debate", "negotiate", "vote", "execute", "settle"];

const twoDigits = (n: number) => String(n).padStart(2, "0");

function Figure({ name, children, className }: { name: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="whitespace-nowrap leading-tight">
      <div className="text-[0.75em] uppercase tracking-widest text-white/35">{name}</div>
      <div className={cn("font-bold tabular-nums text-white", className)}>{children}</div>
    </div>
  );
}

function TopBar({ user, now }: { user: string; now: number | null }) {
  const round = useArena((s) => s.round);
  const phase = useArena((s) => s.phase);
  const committed = useArena((s) => s.committed);
  const mode = useArena((s) => s.mode);
  const nextRoundAt = useArena((s) => s.nextRoundAt);
  const skew = useArena((s) => s.clockSkew);
  // The demo book (src/lib/showcase.ts), moved by the desk's own trades: the same figures as the public page.
  const { equity, pnl } = useShowcaseBook();

  const left = nextRoundAt && now ? Math.max(0, Math.round((nextRoundAt - (now + skew)) / 1000)) : null;
  const active = PHASES.indexOf(phase);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-[3ch] gap-y-1 border-b border-white/15 px-[1.5ch] py-1.5">
      <div className="flex items-center gap-[1ch]">
        <Logo className="size-[1.9em]" />
        <div className="leading-tight">
          <div className="font-bold tracking-widest text-white">{BRAND.toUpperCase()}</div>
          <div className="text-[0.75em] uppercase tracking-widest text-white/35">admin display</div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-[1ch] overflow-hidden whitespace-nowrap">
        <span className="text-white/45">
          session <span className="text-white">#{round}</span>
        </span>
        {PHASES.map((p, i) => (
          <span key={p} className={cn("px-[0.5ch] uppercase", i === active ? "bg-white font-bold text-black" : i < active ? "text-white/50" : "text-white/20")}>
            {p === "vote" && committed ? "join" : p}
          </span>
        ))}
      </div>

      <Figure name="next session">{left === null ? "—" : left === 0 ? "due" : `${twoDigits(Math.floor(left / 60))}:${twoDigits(left % 60)}`}</Figure>
      <Figure name="pool equity">${equity.toFixed(2)}</Figure>
      <Figure name="result" className={pnl > -0.005 ? "!text-green-400" : "!text-red-400"}>
        {fmtSigned(pnl)}
      </Figure>
      <Figure name="agents" className="!text-green-400">
        {mode === "live" ? "AI MODELS" : "READY"}
      </Figure>
      <Figure name={now ? new Date(now).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }) : "clock"}>{now ? new Date(now).toLocaleTimeString("en-GB", { hour12: false }) : "--:--:--"}</Figure>

      <form action={logout} className="flex items-center gap-[1ch]">
        <span className="text-white/35">{user}</span>
        <button type="submit" className="border border-white/25 px-[1ch] py-0.5 text-[0.85em] uppercase tracking-widest text-white/60 hover:border-white hover:text-white">
          sign out
        </button>
      </form>
    </header>
  );
}

/**
 * The desk on one screen, for the admin: the floor, and beside it the trades, the positions
 * and the state of what the desk runs on, set as a terminal would show them. Made to be left
 * on a Raspberry Pi's screen: nothing to click, no scrolling, no effects a small chip can't draw.
 */
export function AdminDisplay({ user }: { user: string }) {
  const { status, reached } = useAdminStatus();
  const now = useNow();
  const phase = useArena((s) => s.phase);
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

  // Nobody is there to press reload, so the page does it itself: after a new version went live,
  // and every few hours. Only between sessions, so that no session is cut short on screen.
  const opened = useRef<{ at: number; version: string | null } | null>(null);
  useEffect(() => {
    if (!status || !reached) return;
    opened.current ??= { at: Date.now(), version: status.version };
    const stale = Date.now() - opened.current.at > RELOAD_AFTER_MS;
    const replaced = status.version !== null && opened.current.version !== null && status.version !== opened.current.version;
    if ((stale || replaced) && phase === "monitor") window.location.reload();
  }, [status, reached, phase]);

  return (
    <div className={cn("stage flex min-h-dvh w-full flex-col bg-black font-mono text-[clamp(11px,0.68vw,16px)] text-white lg:h-dvh lg:overflow-hidden", idle && "cursor-none")}>
      <TopBar user={user} now={now} />
      <Ticker />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_minmax(34rem,36vw)]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 items-center justify-center lg:[container-type:size]">
            <Floor className="!rounded-none lg:!aspect-auto lg:!h-[min(100cqh,calc(100cqw*11/16))] lg:!w-[min(100cqw,calc(100cqh*16/11))]" />
          </div>
          <AgentsStrip />
        </div>
        <div className="flex min-h-0 flex-col gap-2">
          <TradeLog className="h-[24rem] lg:h-auto lg:min-h-0 lg:flex-1" />
          <PositionsPane now={now} className="shrink-0" />
          <SystemPane status={status} reached={reached} now={now} className="shrink-0" />
        </div>
      </main>
    </div>
  );
}
