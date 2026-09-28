"use client";

import { AnimatePresence, motion } from "motion/react";
import { AGENT_ORDER } from "@/lib/agents";
import { pointOf } from "@/lib/layout";
import type { AgentId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { SpeechBubble } from "./speech-bubble";

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

  return (
    <div className="absolute" style={{ left: `${p.x}%`, top: `calc(${p.y}% - var(--char-h) - 14px)` }}>
      <div className="absolute bottom-0 hidden w-60 sm:block" style={{ left: 0, transform: `translateX(-${tail}%)` }}>
        <AnimatePresence mode="wait">{rt.bubble && !rt.walking && <SpeechBubble key={rt.bubble.id} message={rt.bubble} tail={tail} />}</AnimatePresence>
      </div>

      <div className="absolute bottom-0 left-0 -translate-x-1/2">
        <AnimatePresence>
          {rt.vote !== null && !rt.walking && (
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
              {rt.vote ? "✓ YES" : "✕ NO"}
              {rt.voteReason && (
                <span className="absolute bottom-full left-1/2 mb-1 hidden w-max max-w-40 -translate-x-1/2 whitespace-normal rounded-md bg-black/80 px-2 py-1 text-center text-[10px] font-normal leading-tight tracking-normal text-white/85 sm:block">
                  {rt.voteReason}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
