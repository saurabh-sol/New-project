"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { TABLE } from "@/lib/layout";
import { fmtPrice } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useMarket } from "@/store/market";
import { usePoolEquity } from "@/store/selectors";
import { RollingNumber } from "./rolling-number";

const PHASE_COPY: Record<string, string> = {
  scan: "Reading the market",
  pitch: "Agents pitching",
  debate: "Debate in progress",
  negotiate: "Committing capital",
  vote: "Council voting",
  execute: "Sending the order",
  settle: "Session closing",
};

/** Counts down to the next session, in the server's time. */
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

/** The round table in the middle of the floor, with a hologram of the shared pool. */
export function CouncilTable() {
  const phase = useArena((s) => s.phase);
  const focus = useArena((s) => s.focus);
  const agents = useArena((s) => s.agents);
  const quote = useMarket((s) => (focus ? s.quotes[focus] : undefined));
  const equity = usePoolEquity();
  const countdown = useCountdown();
  const status = phase === "monitor" ? (countdown ? `Next session in ${countdown}` : "Watching positions") : PHASE_COPY[phase];

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-full"
      style={{ left: `${TABLE.x}%`, top: `${TABLE.y + 6}%`, width: "var(--table-w)", zIndex: Math.round(TABLE.y * 10) }}
    >
      <svg viewBox="0 0 240 110" className="block w-full overflow-visible">
        <defs>
          <radialGradient id="table-top" cx="50%" cy="35%" r="70%">
            <stop offset="0" stopColor="#9a7652" />
            <stop offset="1" stopColor="#5a4029" />
          </radialGradient>
        </defs>
        <ellipse cx="120" cy="106" rx="112" ry="9" fill="#000" opacity="0.4" />
        <path d="M94 60 H146 L158 104 H82 Z" fill="#2a2017" />
        <ellipse cx="120" cy="49" rx="117" ry="34" fill="#3a2a1c" />
        <ellipse cx="120" cy="42" rx="117" ry="34" fill="url(#table-top)" stroke="#2a1d12" strokeWidth="1.5" />
        {/* projector set into the table */}
        <ellipse cx="120" cy="42" rx="40" ry="11" fill="#0b0f16" />
        <motion.ellipse
          cx="120"
          cy="42"
          rx="34"
          ry="9"
          fill="#38bdf8"
          animate={{ opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>

      {/* hologram */}
      <div className="absolute bottom-[58%] left-1/2 flex w-max -translate-x-1/2 flex-col items-center text-center">
        <div
          className="absolute inset-x-[-10%] bottom-[-14%] top-[30%] -z-10 bg-gradient-to-t from-sky-400/30 to-transparent"
          style={{ clipPath: "polygon(0 0, 100% 0, 68% 100%, 32% 100%)" }}
        />
        <div className="font-mono text-[clamp(6px,0.95cqw,9px)] tracking-[0.3em] text-sky-100/80">POOL EQUITY</div>
        <RollingNumber
          value={equity}
          format={(n) => `$${n.toFixed(2)}`}
          className="font-mono text-[clamp(13px,2.9cqw,27px)] font-bold leading-none text-white [text-shadow:0_0_18px_rgba(56,189,248,0.9)]"
        />
        <AnimatePresence mode="wait">
          {focus && quote && (
            <motion.div
              key={focus}
              className="mt-1 rounded-full border border-sky-300/20 bg-black/70 px-2 py-px font-mono text-[clamp(7px,1.15cqw,11px)]"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              <span className="text-white">{focus}</span> <span className="text-white/60">${fmtPrice(quote.price)}</span>{" "}
              <span className={quote.change24h >= 0 ? "text-green-400" : "text-red-400"}>
                {quote.change24h >= 0 ? "▲" : "▼"}
                {Math.abs(quote.change24h).toFixed(1)}%
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* one pip per council vote */}
        {phase === "vote" && (
          <div className="mt-1 flex gap-1">
            {AGENT_ORDER.map((id) => {
              const vote = agents[id].vote;
              return (
                <motion.span
                  key={id}
                  className="h-1 w-[clamp(8px,1.6cqw,16px)] rounded-full"
                  animate={{ backgroundColor: vote === null ? "#ffffff33" : vote ? "#22c55e" : "#ef4444", scaleY: vote === null ? 1 : 1.6 }}
                  title={AGENTS[id].name}
                />
              );
            })}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            className="mt-1 rounded-full bg-black/60 px-2 py-px text-[clamp(6px,1cqw,10px)] uppercase tracking-widest text-sky-200"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {status}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
