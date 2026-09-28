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
        "hidden items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] tracking-wider sm:inline-flex",
        live ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300",
      )}
    >
      <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-emerald-400" : "bg-amber-400")} />
      {live ? "LIVE AI MODELS" : "SCRIPTED AGENTS"} · PAPER TRADING
    </span>
  );
}
