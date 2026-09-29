"use client";

import { AnimatePresence, motion } from "motion/react";
import { AGENT_ORDER } from "@/lib/agents";
import { pointOf } from "@/lib/layout";
import type { AgentId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { SpeechBubble } from "./speech-bubble";

/** Room for a vote sign and the pointer of the bubble above it, in pixels. */
const SIGN_HEIGHT = 32;

/** Speech bubbles and vote paddles, drawn above everything on the floor. */
export function Overlays() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[2000]">
      {AGENT_ORDER.map((id) => (
        <AgentOverlay key={id} id={id} />
      ))}
    </div>
  );
}

function AgentOverlay({ id }: { id: AgentId }) {
  const rt = useArena((s) => s.agents[id]);
  // Agents only talk and vote while standing still, so the spot is where they are.
  const p = pointOf(id, rt.spot);
  // Keep bubbles inside the arena near its left and right edges.
  const tail = p.x < 30 ? 32 : p.x > 70 ? 68 : 50;
  const speaking = !!rt.bubble && !rt.walking;
  const voted = rt.vote !== null && !rt.walking;

  return (
    <div className="absolute" style={{ left: `${p.x}%`, top: `calc(${p.y}% - var(--char-h) - 14px)` }}>
      {/* An agent that has voted keeps its sign over its head, and what it says goes above the sign. */}
      <div className="absolute w-40 transition-[bottom] duration-200 sm:w-60" style={{ left: 0, bottom: voted ? SIGN_HEIGHT : 0, transform: `translateX(-${tail}%)` }}>
        <AnimatePresence mode="wait">{speaking && rt.bubble && <SpeechBubble key={rt.bubble.id} message={rt.bubble} tail={tail} />}</AnimatePresence>
      </div>

      <div className="absolute bottom-0 left-0 -translate-x-1/2">
        <AnimatePresence>
          {voted && (
            <motion.div
              key={String(rt.vote)}
              className={cn(
                "relative whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold tracking-wider",
                rt.vote ? "bg-white text-black" : "border border-white/50 bg-black text-white",
              )}
              initial={{ opacity: 0, y: 14, scale: 0.3 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.6 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
            >
              {/* The reason for a vote is in the conversation. At the table there is no room for four of them. */}
              {rt.joining ? (rt.vote ? "✓ IN" : "✕ OUT") : rt.vote ? "✓ YES" : "✕ NO"}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
