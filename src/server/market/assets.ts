/**
 * Tokens on Robinhood Chain that a funder may ask for.
 *
 * A Robinhood Stock Token is priced by Robinhood. Any other token is priced by its most
 * liquid trading pool: DexScreener supplies the price and liquidity, GeckoTerminal the candles.
 * None of these needs a key.
 */
import type { Asset, AssetPreview, AssetQuote } from "@/lib/assets";
import { isToken, type Candle, type Interval } from "@/lib/market";
import { cached, getJson } from "./http";
import { findStock, stockCandles, stockQuotes, stockTokens } from "./stocks";

const DEXSCREENER = "https://api.dexscreener.com/latest/dex";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2/networks/robinhood";
/** What DexScreener calls Robinhood Chain. */
const CHAIN = "robinhood";

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

/** A pool token must clear these before an agent will be asked to trade it. */
export const requestLimits = () => ({
  minLiquidityUsd: num(process.env.REQUEST_MIN_LIQUIDITY_USD, 50_000),
  minVolumeUsd: num(process.env.REQUEST_MIN_VOLUME_USD, 10_000),
  minAgeHours: num(process.env.REQUEST_MIN_AGE_HOURS, 24),
});

interface Pair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  pairCreatedAt?: number;
}

const poolQuote = (p: Pair): AssetQuote => ({
  price: Number(p.priceUsd ?? 0),
  change24h: p.priceChange?.h24 ?? 0,
  liquidityUsd: p.liquidity?.usd ?? 0,
  volume24hUsd: p.volume?.h24 ?? 0,
});

export const looksLikeAddress = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q);
const looksLikeSymbol = (q: string) => /^\$?[A-Za-z][A-Za-z.]{0,6}$/.test(q);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const cleanSymbol = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "TOKEN";

/** The symbol with the start of the address, for a token whose symbol belongs to another. */
export const longKey = (asset: Pick<Asset, "symbol" | "address">) => `${cleanSymbol(asset.symbol)}.${asset.address.slice(2, 6).toUpperCase()}`;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Why the desk won't trade a pool token with this quote, or null if it will. */
export function tooThin(symbol: string, quote: AssetQuote, ageHours = Infinity): string | null {
  const limits = requestLimits();
  const liquidity = quote.liquidityUsd ?? 0;
  if (liquidity < limits.minLiquidityUsd) return `${symbol} has ${money(liquidity)} of liquidity. The desk needs at least ${money(limits.minLiquidityUsd)}.`;
  if (quote.volume24hUsd < limits.minVolumeUsd) return `${symbol} traded ${money(quote.volume24hUsd)} in the last day. The desk needs at least ${money(limits.minVolumeUsd)}.`;
  if (ageHours < limits.minAgeHours) return `${symbol} started trading less than ${limits.minAgeHours} hours ago. That is too new for the desk.`;
  return null;
}

const ALREADY_LISTED = (symbol: string) => `${symbol} is already on the desk's list. The agents trade it whenever they see reason to.`;

async function lookupStock(query: string): Promise<AssetPreview | null> {
  const stock = await findStock(query);
  if (!stock) return null;
  if (isToken(stock.symbol)) return { ok: false, error: ALREADY_LISTED(stock.symbol) };
  if (!stock.active) return { ok: false, error: `${stock.symbol} is not trading as a Stock Token right now.` };
  const quote = (await stockQuotes([stock.symbol]))[stock.symbol];
  if (!quote) return { ok: false, error: `There is no live price for ${stock.symbol} right now. Try again in a moment.` };
  if (quote.halted) return { ok: false, error: `Trading in ${stock.symbol} is halted.` };
  return {
    ok: true,
    asset: { key: stock.symbol, symbol: stock.symbol, name: stock.name, address: stock.address, kind: "stock" },
    quote: { price: quote.price, change24h: quote.change, liquidityUsd: null, volume24hUsd: quote.volumeUsd, session: quote.session },
  };
}

async function lookupPool(address: string): Promise<AssetPreview> {
  const pairs = (await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/tokens/${address}`)).pairs ?? [];
  const best = pairs
    .filter((p) => p.chainId === CHAIN && same(p.baseToken.address, address) && Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  if (!best) return { ok: false, error: "No trading pool was found for that address on Robinhood Chain." };

  const quote = poolQuote(best);
  const symbol = best.baseToken.symbol.replace(/^\$/, "");
  const thin = tooThin(symbol, quote, best.pairCreatedAt ? (Date.now() - best.pairCreatedAt) / 3_600_000 : Infinity);
  if (thin) return { ok: false, error: thin };

  const asset = { symbol, name: best.baseToken.name, address: best.baseToken.address, kind: "pool" as const, pool: best.pairAddress };
  // Anyone can launch a token called TSLA. One that borrows a Stock Token's symbol must not be mistaken for it.
  const taken = isToken(cleanSymbol(symbol)) || (await stockTokens().catch(() => new Map())).has(cleanSymbol(symbol));
  return { ok: true, quote, asset: { ...asset, key: taken ? longKey(asset) : cleanSymbol(symbol) } };
}

/** Finds the token a funder named, by contract address or by a Stock Token's symbol. */
export function lookupAsset(input: string): Promise<AssetPreview> {
  const query = input.trim();
  if (!looksLikeAddress(query) && !looksLikeSymbol(query)) {
    return Promise.resolve({ ok: false, error: "Enter a token's address on Robinhood Chain, or a Stock Token's symbol such as MSFT." });
  }
  return cached(`lookup:${query.toLowerCase()}`, 30_000, async (): Promise<AssetPreview> => {
    try {
      const stock = await lookupStock(query);
      if (stock) return stock;
      if (!looksLikeAddress(query)) return { ok: false, error: `There is no Stock Token called ${query.toUpperCase()}. Try its contract address.` };
      return await lookupPool(query);
    } catch {
      return { ok: false, error: "Token data is unavailable right now. Try again in a moment." };
    }
  });
}

export function assetQuote(asset: Asset): Promise<AssetQuote> {
  if (asset.kind === "stock") {
    return stockQuotes([asset.symbol]).then((quotes) => {
      const q = quotes[asset.symbol];
      if (!q) throw new Error(`No live price for ${asset.symbol}`);
      return { price: q.price, change24h: q.change, liquidityUsd: null, volume24hUsd: q.volumeUsd, session: q.session };
    });
  }
  return cached(`quote:${asset.pool}`, 10_000, async () => {
    const { pairs } = await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/pairs/${CHAIN}/${asset.pool}`);
    const pair = pairs?.[0];
    if (!pair || !(Number(pair.priceUsd) > 0)) throw new Error(`No live price for ${asset.symbol}`);
    return poolQuote(pair);
  });
}

// `freshMs` is how long an answer is reused. The candle service allows few requests a minute.
const SPAN: Record<Interval, { unit: "minute" | "hour"; every: number; seconds: number; freshMs: number }> = {
  "1m": { unit: "minute", every: 1, seconds: 60, freshMs: 40_000 },
  "5m": { unit: "minute", every: 5, seconds: 300, freshMs: 90_000 },
  "15m": { unit: "minute", every: 15, seconds: 900, freshMs: 180_000 },
  "1h": { unit: "hour", every: 1, seconds: 3600, freshMs: 300_000 },
};

/**
 * A pool has no candle for a stretch in which nobody traded. Those stretches are filled
 * with flat candles at the last price, so the series is evenly spaced.
 */
function evenly(candles: Candle[], step: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const prev = out[out.length - 1];
    if (prev) for (let t = prev.time + step; t < c.time; t += step) out.push({ time: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0 });
    out.push(c);
  }
  return out;
}

/** How many candles a request may ask for. Few sizes, so that requests for the same pool share an answer. */
const SIZES = [60, 300, 1000];

/**
 * The latest `limit` candles of the token, oldest first.
 * `patient` waits out a service's "too many requests" instead of giving up.
 */
export async function assetCandles(asset: Asset, span: Interval, limit: number, patient = false): Promise<Candle[]> {
  if (asset.kind === "stock") return stockCandles(asset.symbol, span, limit, patient);
  const { unit, every, seconds, freshMs } = SPAN[span];
  const wanted = Math.min(Math.max(limit, 1), 1000);
  const count = SIZES.find((n) => n >= wanted) ?? 1000;
  const all = await cached(`candles:${asset.pool}:${span}:${count}`, freshMs, async () => {
    const url = `${GECKOTERMINAL}/pools/${asset.pool}/ohlcv/${unit}?aggregate=${every}&limit=${count}&currency=usd`;
    const body = await getJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(url, patient);
    const rows = (body.data?.attributes?.ohlcv_list ?? []).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
    return evenly(rows.sort((a, b) => a.time - b.time), seconds).slice(-count);
  });
  return all.slice(-wanted);
}
