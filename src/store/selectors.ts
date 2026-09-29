"use client";

import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { AGENTS } from "@/lib/agents";
import { agentPnl, poolEquity } from "@/lib/council";
import type { AssetKey, Prices } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { useArena } from "./arena";
import { useMarket } from "./market";

/** Live price of every token, as a stable object that only changes when a price does. */
export const usePrices = () =>
  useMarket(
    useShallow((s) => {
      const out: Prices = {};
      for (const [token, quote] of Object.entries(s.quotes)) out[token] = quote?.price;
      return out;
    }),
  );

/** An agent's profit or loss: its cash plus its share of open positions at live prices, against its starting cash. */
export function useAgentPnl(id: AgentId): number {
  const portfolio = useArena((s) => s.portfolio);
  return agentPnl(portfolio, id, usePrices());
}

export function usePoolEquity(): number {
  const portfolio = useArena((s) => s.portfolio);
  return poolEquity(portfolio, usePrices());
}

/** The model actually configured on the server, falling back to the default label. */
export const useModelName = (id: AgentId) => useArena((s) => s.models?.[id].name) ?? AGENTS[id].model;

/** First word of the model name, for the small tag under a walking agent. */
export const shortModel = (name: string) => name.split(/[\s-]/)[0].toUpperCase();

/** The tokens the page shows prices for: the desk's board, then whatever else it holds or has a price for. */
export function useWatched(): AssetKey[] {
  const board = useArena((s) => s.board);
  const positions = useArena((s) => s.portfolio.positions);
  const quotes = useMarket((s) => s.quotes);
  return useMemo(() => {
    const held = positions.map((p) => p.token);
    // Before the first session names a board, the tokens the feed quotes are the trending ones.
    const first = board.length ? board : Object.keys(quotes).filter((k) => !held.includes(k));
    return [...new Set([...first, ...held])];
  }, [board, positions, quotes]);
}
