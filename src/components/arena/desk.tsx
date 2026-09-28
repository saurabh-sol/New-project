"use client";

import { motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import { DESKS, homePoint } from "@/lib/layout";
import type { AgentId } from "@/lib/types";
import { cn, fmtSigned, MIN_SPARK_SPAN } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useAgentPnl, useModelName } from "@/store/selectors";
import { RollingNumber } from "./rolling-number";

const SCREEN = { w: 70, h: 46, y: 6 };

function screenLine(data: number[], x0: number) {
  const pad = 6;
  const w = SCREEN.w - pad * 2;
  const h = SCREEN.h - pad * 2 - 6;
  if (data.length < 2) return `${x0 + pad},${SCREEN.y + pad + 6 + h / 2} ${x0 + pad + w},${SCREEN.y + pad + 6 + h / 2}`;
  const span = Math.max(Math.max(...data) - Math.min(...data), MIN_SPARK_SPAN);
  const min = (Math.min(...data) + Math.max(...data)) / 2 - span / 2;
  return data
    .map((v, i) => `${x0 + pad + (i / (data.length - 1)) * w},${SCREEN.y + pad + 6 + h - ((v - min) / span) * h}`)
    .join(" ");
}

/** An agent's workstation: desk, monitor with its PnL curve, and a nameplate. */
export function Desk({ id }: { id: AgentId }) {
  const agent = AGENTS[id];
  const desk = DESKS[id];
  const rt = useArena((s) => s.agents[id]);
  const pnl = useAgentPnl(id);
  const model = useModelName(id);
  const atDesk = rt.spot.kind === "home" && !rt.walking;
  const busy = atDesk && (rt.state === "thinking" || rt.state === "executing");
  const executing = atDesk && rt.state === "executing";

  // Monitor sits on the outer side, the agent stands on the inner side.
  const mx = desk.side === "left" ? 14 : 116;
  const kx = desk.side === "left" ? 108 : 42;
  const up = pnl > -0.005;

  const seat = homePoint(id);

  return (
    <>
      {/* office chair, behind the agent */}
      <svg
        viewBox="0 0 60 90"
        className="absolute -translate-x-1/2 -translate-y-full overflow-visible"
        style={{ left: `${seat.x}%`, top: `${seat.y}%`, width: "calc(var(--char-w) * 0.95)", zIndex: Math.round(seat.y * 10) - 5 }}
      >
        <rect x="27" y="58" width="6" height="26" fill="#1f2937" />
        <rect x="8" y="2" width="44" height="52" rx="12" fill="#1b2433" stroke="#0b0f16" strokeWidth="2" />
        <rect x="13" y="7" width="34" height="42" rx="9" fill="#263244" />
        <rect x="4" y="52" width="52" height="10" rx="5" fill="#111827" />
      </svg>

    <div
      className="absolute -translate-x-1/2 -translate-y-full"
      style={{ left: `${desk.x}%`, top: `${desk.y}%`, width: "var(--desk-w)", zIndex: Math.round(desk.y * 10) }}
    >
      <svg viewBox="0 0 200 120" className="block w-full overflow-visible">
        <defs>
          <linearGradient id={`desk-top-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#8a6a4a" />
            <stop offset="1" stopColor="#5f4630" />
          </linearGradient>
        </defs>

        {/* floor glow */}
        <ellipse cx="100" cy="117" rx="108" ry="9" fill="#000" opacity="0.35" />

        {/* monitor */}
        <rect x={mx + 30} y="48" width="10" height="12" fill="#334155" />
        <ellipse cx={mx + 35} cy="61" rx="16" ry="3.5" fill="#334155" />
        <motion.rect
          x={mx}
          y={SCREEN.y}
          width={SCREEN.w}
          height={SCREEN.h}
          rx="5"
          fill="#05070b"
          stroke={agent.color}
          strokeWidth="1.6"
          animate={{ strokeOpacity: busy ? [0.5, 1, 0.5] : 0.5 }}
          transition={busy ? { duration: 0.5, repeat: Infinity } : { duration: 0.3 }}
          style={{ filter: `drop-shadow(0 0 ${busy ? 7 : 3}px ${agent.color})` }}
        />
        <motion.rect
          x={mx + 2}
          y={SCREEN.y + 2}
          width={SCREEN.w - 4}
          height={SCREEN.h - 4}
          rx="3.5"
          fill={agent.color}
          animate={{ opacity: executing ? [0.1, 0.45, 0.1] : 0.06 }}
          transition={executing ? { duration: 0.35, repeat: Infinity } : { duration: 0.3 }}
        />
        <text x={mx + 6} y={SCREEN.y + 10} fontSize="6.5" fontFamily="monospace" fill={agent.color} opacity="0.85">
          {executing ? "SENDING ORDER" : "PNL"}
        </text>
        <polyline
          points={screenLine(rt.history, mx)}
          fill="none"
          stroke={up ? "#4ade80" : "#f87171"}
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* desk */}
        <path d="M16 56 H184 L200 80 H0 Z" fill={`url(#desk-top-${id})`} stroke={agent.color} strokeOpacity="0.35" />
        <rect x={kx} y="63" width="50" height="9" rx="2.5" fill="#05070b" opacity="0.85" />
        <motion.rect
          x={kx + 3}
          y="65.5"
          width="44"
          height="4"
          rx="1.5"
          fill={agent.color}
          animate={{ opacity: busy ? [0.25, 0.9, 0.25] : 0.2 }}
          transition={busy ? { duration: 0.24, repeat: Infinity } : { duration: 0.3 }}
        />
        <rect x="2" y="80" width="196" height="38" rx="5" fill="#141b27" stroke="#000" strokeOpacity="0.4" />
        <rect x="2" y="80" width="196" height="3" rx="1.5" fill={agent.color} opacity="0.85" />
      </svg>

      {/* nameplate */}
      <div className="absolute inset-x-[4%] bottom-[2%] flex h-[28%] items-center justify-between gap-1">
        <div className="min-w-0 leading-none">
          <div className="truncate text-[clamp(7px,1.45cqw,13px)] font-semibold text-white">{agent.name}</div>
          <div className="mt-[0.2em] truncate font-mono text-[clamp(6px,0.95cqw,9px)] uppercase tracking-wider" style={{ color: agent.color }}>
            {model}
          </div>
        </div>
        <RollingNumber
          value={pnl}
          format={(n) => fmtSigned(n)}
          className={cn("font-mono text-[clamp(7px,1.45cqw,13px)] font-bold tabular-nums", up ? "text-green-400" : "text-red-400")}
        />
      </div>
    </div>
    </>
  );
}
