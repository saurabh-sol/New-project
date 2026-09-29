"use client";

import { motion } from "motion/react";
import { AGENTS } from "@/lib/agents";
import { DESKS } from "@/lib/layout";
import type { Pt } from "@/lib/types";
import { withAlpha } from "@/lib/utils";
import { useArena, type Coin, type Ticket } from "@/store/arena";

/** Points along an arc that lifts off the floor between a and b. */
function arc(a: Pt, b: Pt, lift = 14, n = 16): Pt[] {
  const c = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return {
      x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
      y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
    };
  });
}

export function EffectsLayer() {
  const coins = useArena((s) => s.coins);
  const tickets = useArena((s) => s.tickets);

  return (
    <div className="pointer-events-none absolute inset-0 z-[1900]">
      {coins.map((c) => (
        <CoinFlight key={c.id} coin={c} />
      ))}
      {tickets.map((t) => (
        <TicketFlight key={t.id} ticket={t} />
      ))}
    </div>
  );
}

/** Capital handed from one agent to another: a stream of coins. */
function CoinFlight({ coin }: { coin: Coin }) {
  const removeCoin = useArena((s) => s.removeCoin);
  const pts = arc(coin.from, coin.to);
  const COUNT = 6;

  return (
    <>
      {Array.from({ length: COUNT }, (_, i) => (
        <motion.div
          key={i}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          initial={{ left: `${pts[0].x}%`, top: `${pts[0].y}%`, opacity: 0, scale: 0.4 }}
          animate={{
            left: pts.map((p) => `${p.x}%`),
            top: pts.map((p) => `${p.y}%`),
            opacity: [0, 1, 1, 1, 0],
            scale: [0.4, 1.1, 1, 1, 0.5],
            rotate: [0, 360],
          }}
          transition={{ duration: 1.1, delay: i * 0.12, ease: [0.45, 0, 0.3, 1] }}
          onAnimationComplete={i === COUNT - 1 ? () => removeCoin(coin.id) : undefined}
        >
          {i === 0 ? (
            <div className="rounded-full bg-gradient-to-b from-white/30 to-white/30 px-2 py-0.5 font-mono text-[11px] font-bold text-white shadow-[0_0_16px_rgba(251,191,36,0.7)]">
              ${coin.amount}
            </div>
          ) : (
            <div className="size-3.5 rounded-full border border-white/30 bg-gradient-to-b from-white/30 to-white/30 shadow-[0_0_10px_rgba(251,191,36,0.6)]" />
          )}
        </motion.div>
      ))}
    </>
  );
}

/** Trade ticket that launches from the agent's monitor toward the trade feed below. */
function TicketFlight({ ticket }: { ticket: Ticket }) {
  const removeTicket = useArena((s) => s.removeTicket);
  const t = ticket.fill;
  const desk = DESKS[t.leader];
  const color = AGENTS[t.leader].color;
  const label = t.reason === "STOP" ? "STOP-LOSS HIT" : t.reason === "TARGET" ? "TARGET HIT" : t.reason === "FALLING" ? "SOLD INTO A FALL" : "ORDER FILLED";
  const from = { x: desk.x, y: desk.y - 14 };

  return (
    <motion.div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      initial={{ left: `${from.x}%`, top: `${from.y}%`, scale: 0.3, opacity: 0 }}
      animate={{
        left: [`${from.x}%`, "50%", "50%", "50%"],
        top: [`${from.y}%`, "42%", "42%", "112%"],
        scale: [0.3, 1.15, 1, 0.5],
        opacity: [0, 1, 1, 0],
      }}
      transition={{ duration: 2.6, times: [0, 0.3, 0.72, 1], ease: "easeInOut" }}
      onAnimationComplete={() => removeTicket(ticket.id)}
    >
      <div
        className="rounded-xl border bg-[#0b0f16]/95 px-4 py-2.5 text-center shadow-2xl backdrop-blur"
        style={{ borderColor: color, boxShadow: `0 0 40px ${withAlpha(color, 0.5)}` }}
      >
        <div className="font-mono text-[10px] tracking-[0.25em] text-white/50">{label}</div>
        <div className="mt-0.5 font-mono text-lg font-bold" style={{ color: t.side === "BUY" ? "#4ade80" : "#f87171" }}>
          {t.side} {t.token}
        </div>
        <div className="font-mono text-xs text-white/70">${t.usd.toFixed(2)} · filled</div>
      </div>
    </motion.div>
  );
}
