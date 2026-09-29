import { create } from "zustand";
import { fetchQuotes, type AssetKey, type Prices, type Quote } from "@/lib/market";

interface MarketStore {
  /** Live quotes of the tokens on the desk's board and of those it holds. */
  quotes: Record<AssetKey, Quote | undefined>;
  /** "live" once real quotes arrived, "down" if the feed can't be reached. */
  status: "loading" | "live" | "down";
  setQuotes: (q: Record<AssetKey, Quote | undefined>) => void;
  /** Quotes the server passed on for tokens funders asked for. They say nothing about the public feed's health. */
  setAssetQuotes: (q: Record<AssetKey, Quote>) => void;
  setPrice: (token: AssetKey, price: number) => void;
  setStatus: (s: MarketStore["status"]) => void;
}

export const useMarket = create<MarketStore>((set) => ({
  quotes: {},
  status: "loading",
  setQuotes: (q) => set((s) => ({ quotes: { ...s.quotes, ...q }, status: "live" })),
  setAssetQuotes: (q) => set((s) => ({ quotes: { ...s.quotes, ...q } })),
  setPrice: (token, price) =>
    set((s) => {
      const prev = s.quotes[token];
      return prev ? { quotes: { ...s.quotes, [token]: { ...prev, price } } } : {};
    }),
  setStatus: (status) => set({ status }),
}));

/** Latest real price of every token the feed has delivered. */
export const livePrices = (): Prices => {
  const out: Prices = {};
  for (const [token, quote] of Object.entries(useMarket.getState().quotes)) out[token] = quote?.price;
  return out;
};

/** Latest real quote for a token, if the feed has delivered one. */
export const liveQuote = (token: AssetKey): Quote | undefined => useMarket.getState().quotes[token];

// The tokens the desk trades move in seconds, so their prices are asked for often.
const POLL_MS = 5_000;

let watchers = 0;
let stopPolling: (() => void) | null = null;

/**
 * Polls the quotes of every token the desk watches, while anything on the page needs them.
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
