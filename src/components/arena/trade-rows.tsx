"use client";

import { useEffect, useState } from "react";
import type { Fill } from "@/lib/council";
import { isSample } from "@/lib/use-sample-fills";

/** How many rows a list shows in the same frame as the click, and how many more it adds each frame after. */
const FIRST = 60;
const STEP = 120;

/**
 * How many of a long list's rows to render now. A switch between the views paints its first rows in the
 * same frame as the click and the rest over the next few, instead of holding the page while hundreds of
 * rows are laid out at once. A row that comes in later is shown at once, since the count only trails the total.
 */
export function useReveal(total: number, key: string): number {
  const [state, setState] = useState({ key, n: FIRST });
  const n = state.key === key ? state.n : FIRST;
  useEffect(() => {
    if (n >= total) return;
    const id = requestAnimationFrame(() => setState({ key, n: Math.min(total, n + STEP) }));
    return () => cancelAnimationFrame(id);
  }, [key, n, total]);
  return Math.min(n, total);
}

interface Seen {
  /** The list these were taken from. */
  fills: Fill[] | null;
  /** Every trade seen so far. */
  ids: Set<string>;
  /** The trades that were new in the latest list. */
  fresh: Set<string>;
}

/**
 * The desk's own trades that came in while the page was open, by id: the ones a list animates in.
 * Everything on record when the page opened, and every sample trade, is shown still, so a switch
 * between the views moves nothing. A trade counts as new once, the first time it is seen.
 */
export function useFreshTrades(fills: Fill[]): Set<string> {
  const [opened] = useState(() => Date.now());
  const [seen, setSeen] = useState<Seen>({ fills: null, ids: new Set(), fresh: new Set() });
  if (seen.fills !== fills) {
    // The page's first list has every trade on record; those are not new.
    const first = seen.fills === null;
    const ids = new Set(seen.ids);
    const fresh = new Set<string>();
    for (const f of fills) {
      if (ids.has(f.id)) continue;
      ids.add(f.id);
      if (!first && !isSample(f) && f.ts > opened - 60_000) fresh.add(f.id);
    }
    setSeen({ fills, ids, fresh });
  }
  return seen.fresh;
}
