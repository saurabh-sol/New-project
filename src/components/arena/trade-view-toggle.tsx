"use client";

import { setTradeView, useTradeView, type TradeView } from "@/lib/trade-view";
import { cn } from "@/lib/utils";

const VIEWS: { id: TradeView; label: string; title: string }[] = [
  { id: "gains", label: "Gains", title: "Only the sales that booked a gain" },
  { id: "all", label: "All", title: "Every order, losses included" },
];

/** Switches both trade lists between the sales that made a gain and every order. */
export function TradeViewToggle({ className }: { className?: string }) {
  const view = useTradeView();
  return (
    <div role="group" aria-label="Which trades to show" className={cn("flex shrink-0 overflow-hidden rounded-full border border-white/15 font-mono text-[10px] uppercase tracking-widest", className)}>
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          title={v.title}
          aria-pressed={view === v.id}
          onClick={() => setTradeView(v.id)}
          className={cn("px-2.5 py-1 transition-colors", view === v.id ? "bg-white text-black" : "text-white/55 hover:text-white")}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
