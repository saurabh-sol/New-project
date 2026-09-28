import { create } from "zustand";
import { fetchQuotes, isToken, type Quote, type Token } from "@/lib/market";

interface MarketStore {
  quotes: Partial<Record<Token, Quote>>;
  /** "live" once real quotes arrived, "down" if the feed can't be reached. */
  status: "loading" | "live" | "down";
  setQuotes: (q: Partial<Record<Token, Quote>>) => void;
  setPrice: (token: Token, price: number) => void;
  setStatus: (s: MarketStore["status"]) => void;
}

export const useMarket = create<MarketStore>((set) => ({
  quotes: {},
  status: "loading",
  setQuotes: (q) => set((s) => ({ quotes: { ...s.quotes, ...q }, status: "live" })),
  setPrice: (token, price) =>
    set((s) => {
      const prev = s.quotes[token];
      return prev ? { quotes: { ...s.quotes, [token]: { ...prev, price } } } : {};
    }),
  setStatus: (status) => set({ status }),
}));

/** Latest real price of every token the feed has delivered. */
export const livePrices = (): Partial<Record<Token, number>> => {
  const out: Partial<Record<Token, number>> = {};
  for (const [token, quote] of Object.entries(useMarket.getState().quotes)) out[token as Token] = quote.price;
  return out;
};

/** Latest real quote for a token, if the feed has delivered one. */
export const liveQuote = (token: string): Quote | undefined =>
  isToken(token) ? useMarket.getState().quotes[token] : undefined;

const POLL_MS = 10_000;

let watchers = 0;
let stopPolling: (() => void) | null = null;

/**
 * Polls 24h quotes for every token while anything on the page needs them.
 * Safe to call from several components: polling starts with the first and stops with the last.
 */
export function startQuotes(): () => void {
  watchers++;
  if (!stopPolling) stopPolling = poll();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--watchers === 0) {
      stopPolling?.();
      stopPolling = null;
    }
  };
}

function poll(): () => void {
  const ctrl = new AbortController();
  const tick = async () => {
    try {
      useMarket.getState().setQuotes(await fetchQuotes(ctrl.signal));
    } catch {
      if (!ctrl.signal.aborted && useMarket.getState().status !== "live") useMarket.getState().setStatus("down");
    }
  };
  tick();
  const id = setInterval(tick, POLL_MS);
  // Don't hold the show forever on a hanging request.
  const giveUp = setTimeout(() => {
    if (useMarket.getState().status === "loading") useMarket.getState().setStatus("down");
  }, 4000);
  return () => {
    ctrl.abort();
    clearInterval(id);
    clearTimeout(giveUp);
  };
}
