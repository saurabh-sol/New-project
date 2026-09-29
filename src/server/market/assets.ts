/**
 * Prices and candles for Solana tokens named by mint address.
 * DexScreener supplies the token, its price and its liquidity; GeckoTerminal supplies candles.
 * Both are public and need no key.
 */
import type { Asset, AssetPreview, AssetQuote } from "@/lib/assets";
import { isToken, type Candle } from "@/lib/market";

const DEXSCREENER = "https://api.dexscreener.com/latest/dex";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2/networks/solana";

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

/** A token must clear these before an agent will be asked to trade it. */
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

// Both services limit how often they may be asked, so answers are reused for a few seconds.
const shared = globalThis as typeof globalThis & { __assetCache?: Map<string, { at: number; value: Promise<unknown> }> };

const FAILED_MS = 10_000;

function cached<T>(key: string, freshMs: number, load: () => Promise<T>): Promise<T> {
  const cache = (shared.__assetCache ??= new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < freshMs) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  // A failure is remembered too, briefly: asking again at once only makes a busy service busier.
  value.catch(() => cache.get(key)?.value === value && cache.set(key, { at: Date.now() - freshMs + Math.min(freshMs, FAILED_MS), value }));
  if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > 60_000) cache.delete(k);
  return value;
}

/** Waits between tries, in ms. A caller that can afford to wait out "too many requests" is `patient`. */
const WAITS = { quick: [700, 1500], patient: [3_000, 8_000, 15_000] };

/** These services time out or ask for patience now and then, so a request is tried more than once. */
async function getJson<T>(url: string, patient = false): Promise<T> {
  const waits = patient ? WAITS.patient : WAITS.quick;
  let problem: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, waits[attempt - 1]));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
      if (res.ok) return (await res.json()) as T;
      problem = new Error(`Token data request failed (${res.status})`);
      // Anything but "too many requests" or a server fault will fail the same way again.
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      problem = e;
    }
  }
  throw problem;
}

const quoteOf = (p: Pair): AssetQuote => ({
  price: Number(p.priceUsd ?? 0),
  change24h: p.priceChange?.h24 ?? 0,
  liquidityUsd: p.liquidity?.usd ?? 0,
  volume24hUsd: p.volume?.h24 ?? 0,
});

/** Solana addresses are 32 to 44 characters of base58. */
export const looksLikeMint = (q: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);

const cleanSymbol = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "TOKEN";

/** The symbol with the start of the address, for a token whose symbol is already taken by another. */
export const longKey = (asset: Pick<Asset, "symbol" | "address">) => `${cleanSymbol(asset.symbol)}.${asset.address.slice(0, 4)}`;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Why the desk won't trade a token with this quote, or null if it will. */
export function tooThin(symbol: string, quote: AssetQuote, ageHours = Infinity): string | null {
  const limits = requestLimits();
  if (quote.liquidityUsd < limits.minLiquidityUsd) return `${symbol} has ${money(quote.liquidityUsd)} of liquidity. The desk needs at least ${money(limits.minLiquidityUsd)}.`;
  if (quote.volume24hUsd < limits.minVolumeUsd) return `${symbol} traded ${money(quote.volume24hUsd)} in the last day. The desk needs at least ${money(limits.minVolumeUsd)}.`;
  if (ageHours < limits.minAgeHours) return `${symbol} started trading less than ${limits.minAgeHours} hours ago. That is too new for the desk.`;
  return null;
}

/** Finds the token at a mint address and checks it is liquid enough to be worth an agent's time. */
export function lookupAsset(address: string): Promise<AssetPreview> {
  const query = address.trim();
  if (!looksLikeMint(query)) return Promise.resolve({ ok: false, error: "That is not a Solana token address." });
  return cached(`lookup:${query}`, 30_000, async (): Promise<AssetPreview> => {
    let pairs: Pair[];
    try {
      pairs = (await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/tokens/${query}`)).pairs ?? [];
    } catch {
      return { ok: false, error: "Token data is unavailable right now. Try again in a moment." };
    }
    const best = pairs
      .filter((p) => p.chainId === "solana" && p.baseToken.address === query && Number(p.priceUsd) > 0)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    if (!best) return { ok: false, error: "No trading pool was found for that address on Solana." };

    const quote = quoteOf(best);
    const symbol = best.baseToken.symbol.replace(/^\$/, "");
    const thin = tooThin(symbol, quote, best.pairCreatedAt ? (Date.now() - best.pairCreatedAt) / 3_600_000 : Infinity);
    if (thin) return { ok: false, error: thin };

    const asset = { symbol, name: best.baseToken.name, address: best.baseToken.address, pool: best.pairAddress };
    // A token that borrows a listed token's symbol must not be mistaken for it.
    return { ok: true, quote, asset: { ...asset, key: isToken(cleanSymbol(symbol)) ? longKey(asset) : cleanSymbol(symbol) } };
  });
}

export function assetQuote(asset: Asset): Promise<AssetQuote> {
  return cached(`quote:${asset.pool}`, 10_000, async () => {
    const { pairs } = await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/pairs/solana/${asset.pool}`);
    const pair = pairs?.[0];
    if (!pair || !(Number(pair.priceUsd) > 0)) throw new Error(`No live price for ${asset.symbol}`);
    return quoteOf(pair);
  });
}

export type Span = "1m" | "5m" | "15m" | "1h";
// `freshMs` is how long an answer is reused. The candle service allows few requests a minute,
// and every viewer and every risk check draws on the same allowance.
const SPAN: Record<Span, { unit: "minute" | "hour"; every: number; seconds: number; freshMs: number }> = {
  "1m": { unit: "minute", every: 1, seconds: 60, freshMs: 40_000 },
  "5m": { unit: "minute", every: 5, seconds: 300, freshMs: 90_000 },
  "15m": { unit: "minute", every: 15, seconds: 900, freshMs: 180_000 },
  "1h": { unit: "hour", every: 1, seconds: 3600, freshMs: 300_000 },
};

export const isSpan = (v: unknown): v is Span => typeof v === "string" && v in SPAN;

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
 * The latest `limit` candles of the token's pool, oldest first.
 * `patient` waits out the service's "too many requests" instead of giving up.
 */
export async function assetCandles(asset: Asset, span: Span, limit: number, patient = false): Promise<Candle[]> {
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
