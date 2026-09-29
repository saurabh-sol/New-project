"use client";

import { useEffect } from "react";
import { priceDecimals } from "@/lib/market";
import { startQuotes, useMarket } from "@/store/market";
import { useWatched } from "@/store/selectors";

/** Live prices running under the header. */
export function Ticker() {
  const quotes = useMarket((s) => s.quotes);
  useEffect(() => startQuotes(), []);
  const watched = useWatched();
  const rows = watched.flatMap((t) => (quotes[t] ? [{ token: t, ...quotes[t] }] : []));
  if (rows.length === 0) return <div className="h-8 border-b border-white/5" />;

  // Repeated so the strip is always wider than the screen and can loop without a gap.
  const strip = [...rows, ...rows, ...rows, ...rows, ...rows, ...rows];
  return (
    <div className="overflow-hidden border-b border-white/5 bg-black/30" aria-label="Live prices">
      <div className="ticker-track flex w-max gap-10 whitespace-nowrap py-1.5 font-mono text-xs">
        {strip.map((r, i) => (
          <span key={i} className="flex items-center gap-2" aria-hidden={i >= rows.length}>
            <span className="font-semibold text-white">{r.token}</span>
            <span className="text-white/55">${r.price.toFixed(priceDecimals(r.price))}</span>
            <span className={r.change24h >= 0 ? "text-emerald-400" : "text-red-400"}>
              {r.change24h >= 0 ? "▲" : "▼"} {Math.abs(r.change24h).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
