/** Live quotes for the tokens the desk lists: ETH from the exchange feed, Stock Tokens from Robinhood. */
import { cryptoQuotes, isCrypto, TOKENS, type Quote, type Token } from "@/lib/market";
import { cached } from "./http";
import { stockQuotes } from "./stocks";

const STOCKS = TOKENS.filter((t) => !isCrypto(t));

/** A token that can't be quoted is left out. Throws only if nothing at all can be quoted. */
export function listedQuotes(): Promise<Partial<Record<Token, Quote>>> {
  return cached("quotes:listed", 8_000, async () => {
    const [crypto, stocks] = await Promise.all([cryptoQuotes(AbortSignal.timeout(10_000)).catch(() => null), stockQuotes(STOCKS).catch(() => null)]);
    if (!crypto && !stocks) throw new Error("No market data available");
    const out: Partial<Record<Token, Quote>> = {};
    for (const t of TOKENS) {
      const c = crypto?.[t];
      const s = stocks?.[t];
      if (c) out[t] = c;
      else if (s) out[t] = { price: s.price, change24h: s.change, high24h: s.high, low24h: s.low, session: s.session };
    }
    return out;
  });
}
