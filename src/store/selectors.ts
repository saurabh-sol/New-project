"use client";

import { useShallow } from "zustand/react/shallow";
import { AGENTS } from "@/lib/agents";
import { agentPnl, poolEquity } from "@/lib/council";
import type { Token } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { useArena } from "./arena";
import { useMarket } from "./market";

/** Live price of every token, as a stable object that only changes when a price does. */
export const usePrices = () =>
  useMarket(
    useShallow((s) => {
      const out: Partial<Record<Token, number>> = {};
      for (const [token, quote] of Object.entries(s.quotes)) out[token as Token] = quote.price;
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
