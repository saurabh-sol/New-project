"use client";

import { motion } from "motion/react";
import type { Phase } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";

const PHASES: Phase[] = ["monitor", "scan", "pitch", "debate", "negotiate", "vote", "execute", "settle"];

export function PhaseTimeline() {
  const phase = useArena((s) => s.phase);
  const round = useArena((s) => s.round);
  const active = PHASES.indexOf(phase);

  return (
    <div className="flex items-center gap-3 overflow-x-auto panel p-1.5 [scrollbar-width:none]">
      <div className="shrink-0 pl-2 font-mono text-[11px] text-white/50">
        SESSION <span className="text-white">#{round}</span>
      </div>
      <div className="flex flex-1 items-center gap-1">
        {PHASES.map((p, i) => (
          <div key={p} className="relative flex-1">
            {i === active && (
              <motion.div
                layoutId="phase-pill"
                className="absolute inset-0 rounded-xl bg-gradient-to-r from-white/30 to-white/30 ring-1 ring-white/50"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            <div
              className={cn(
                "relative whitespace-nowrap px-2 py-1.5 text-center font-mono text-[10px] uppercase tracking-wider transition-colors sm:text-[11px]",
                i === active ? "text-white" : i < active ? "text-white/50" : "text-white/25",
              )}
            >
              {i < active && <span className="mr-1 text-green-400">✓</span>}
              {p}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
