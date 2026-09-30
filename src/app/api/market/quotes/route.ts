import type { Asset } from "@/lib/assets";
import { isToken, type AssetKey, type Quote } from "@/lib/market";
import { readState } from "@/server/council/store";
import { assetQuotes } from "@/server/market/assets";
import { cachedOrKept } from "@/server/market/http";
import { listedQuotes } from "@/server/market/quotes";
import { trendingBoard } from "@/server/market/trending";

/** A quote that can't be had again for the moment is shown as it was, for this long at most. */
const KEEP_MS = 2 * 60_000;

const shared = globalThis as typeof globalThis & { __quotesKept?: Map<AssetKey, { at: number; quote: Quote }> };

/** What is quoted: the desk's board, and whatever it holds. Read from the books, which change far less often than prices. */
const watched = () =>
  cachedOrKept("quotes:watched", 5_000, KEEP_MS, async () => {
    const state = await readState();
    const held = state.portfolio.positions.map((p) => p.token);
    let board = state.board ?? [];
    let assets = state.assets;
    // Before the first session there is no board yet. The trending tokens are shown all the same.
    if (board.length === 0) {
      const trending = await trendingBoard(state.assets).catch(() => []);
      board = trending.map((a) => a.key);
      assets = { ...Object.fromEntries(trending.map((a) => [a.key, a])), ...assets };
    }
    const keys = [...new Set([...board, ...held])];
    return { assets: keys.flatMap((k): Asset[] => (assets[k] && !isToken(k) ? [assets[k]] : [])), old: held.filter(isToken) };
  });

/** Live quotes for the tokens on the desk's board and the tokens it holds. */
export async function GET() {
  try {
    const { assets, old } = await watched();
    const none: Record<string, Quote | undefined> = {};
    const [pools, listed] = await Promise.all([assetQuotes(assets), old.length ? listedQuotes().catch(() => none) : none]);
    // ETH and Stock Tokens are quoted only while the desk still holds them.
    const quotes: Record<AssetKey, Quote> = {};
    for (const key of old) if (listed[key]) quotes[key] = listed[key]!;
    for (const [key, q] of Object.entries(pools)) quotes[key] = { price: q.price, change24h: q.change24h, session: q.session, change5m: q.change5m, change1h: q.change1h };

    // The data services refuse a request now and then. A token they left out keeps the quote it had a moment ago.
    const kept = (shared.__quotesKept ??= new Map());
    const now = Date.now();
    for (const [key, last] of kept) if (now - last.at >= KEEP_MS) kept.delete(key);
    for (const [key, quote] of Object.entries(quotes)) kept.set(key, { at: now, quote });
    for (const key of [...assets.map((a) => a.key), ...old]) if (!quotes[key] && kept.has(key)) quotes[key] = kept.get(key)!.quote;

    if (assets.length > 0 && Object.keys(quotes).length === 0) throw new Error("No market data available");
    return Response.json({ quotes }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Market data can't be reached right now." }, { status: 502 });
  }
}
