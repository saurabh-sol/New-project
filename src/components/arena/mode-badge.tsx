"use client";

import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";

/** Says plainly whether the agents are real models right now, and that the trades are paper trades. */
export function ModeBadge() {
  const ready = useArena((s) => s.ready);
  const mode = useArena((s) => s.mode);
  const note = useArena((s) => s.modeNote);
  if (!ready) return null;
  const live = mode === "live";

  return (
    <span
      title={note ?? "The agents are live AI models. Trades are paper trades at real market prices."}
      className={cn(
        "hidden items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] tracking-wider lg:inline-flex",
        live ? "border-white/30 bg-white/10 text-white/80" : "border-white/30 bg-white/10 text-white/80",
      )}
    >
      <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-white" : "bg-white")} />
      {live ? "LIVE AI MODELS" : "SCRIPTED AGENTS"} · PAPER TRADING
    </span>
  );
}
