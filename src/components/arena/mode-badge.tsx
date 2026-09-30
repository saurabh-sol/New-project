"use client";

import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";

/** Says plainly whether the agents are real models right now, and where their trades are settled. */
export function ModeBadge() {
  const ready = useArena((s) => s.ready);
  const mode = useArena((s) => s.mode);
  const note = useArena((s) => s.modeNote);
  const desk = useArena((s) => s.desk);
  if (!ready) return null;
  const live = mode === "live";

  return (
    <span
      title={
        note ??
        (desk?.market
          ? "The agents are live AI models. Their trades are real swaps in the tokens' pools on Robinhood Chain, each from the agent's own wallet."
          : "The agents are live AI models. Their trades are settled at live prices against the desk's treasury. No order goes to a market.")
      }
      className={cn(
        "hidden items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 font-mono text-[10px] tracking-wider min-[1120px]:inline-flex",
        live ? "border-white/30 bg-white/10 text-white/80" : "border-white/30 bg-white/10 text-white/80",
      )}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-green-400" />
      {live ? "LIVE AI MODELS" : "LIVE AGENTS"}
      {desk?.market ? " · REAL SWAPS" : desk ? " · SETTLED ON-CHAIN" : ""}
    </span>
  );
}
