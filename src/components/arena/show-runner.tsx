"use client";

import { useEffect } from "react";
import { startShow } from "@/lib/director";
import { useArena } from "@/store/arena";
import { livePrices, startQuotes, useMarket } from "@/store/market";

/**
 * Runs the live prices and the council's show for as long as the site is open.
 * It sits above the pages, so moving from one page to another doesn't stop the show
 * or start the session over.
 */
export function ShowRunner() {
  const apply = useArena((s) => s.apply);
  const samplePnl = useArena((s) => s.samplePnl);
  const feedSettled = useMarket((s) => s.status !== "loading");

  useEffect(() => startQuotes(), []);

  // Wait for the first real quotes so the desk opens on real prices.
  useEffect(() => {
    if (feedSettled) return startShow(apply);
  }, [feedSettled, apply]);

  // Sample each agent's result for the sparklines.
  useEffect(() => {
    if (!feedSettled) return;
    const id = setInterval(() => samplePnl(livePrices()), 10_000);
    return () => clearInterval(id);
  }, [feedSettled, samplePnl]);

  return null;
}
