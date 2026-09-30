"use client";

import { useArena } from "@/store/arena";
import { usePrices } from "@/store/selectors";
import { agentPnl, poolCapital, poolCash, poolEquity } from "./council";
import { SHOWCASE_AGENT_CAPITAL, SHOWCASE_EQUITY, SHOWCASE_PNL, showcaseResult } from "./showcase";
import type { AgentId } from "./types";

export interface ShowcaseBook {
  /** The pool's figure: the demo equity, less what the desk's open positions cost, plus what its closed trades made. */
  equity: number;
  /** The council's result: the demo result, plus what the desk's own trades have made or lost, open ones at live prices. */
  pnl: number;
  /** An agent's result: its demo result plus its own trades' result. */
  result: (id: AgentId) => number;
  /** An agent's result as a percentage of its capital. */
  pct: (id: AgentId) => number;
}

/**
 * The demo book (src/lib/showcase.ts), moved by the desk's own trades: when an agent buys, the cost comes off
 * the pool; when it sells, the money comes back with what it made; and the result follows every trade, the open
 * ones at live prices. Before the desk's books arrive, it is the demo book as it stands. The admin's display
 * shows the same book.
 */
export function useShowcaseBook(): ShowcaseBook {
  const portfolio = useArena((s) => s.portfolio);
  const prices = usePrices();
  const capital = poolCapital(portfolio);
  const equity = SHOWCASE_EQUITY + poolCash(portfolio) - capital;
  const pnl = SHOWCASE_PNL + poolEquity(portfolio, prices) - capital;
  const result = (id: AgentId) => showcaseResult(id) + agentPnl(portfolio, id, prices);
  const pct = (id: AgentId) => (result(id) / SHOWCASE_AGENT_CAPITAL) * 100;
  return { equity, pnl, result, pct };
}
