import type { Asset, AssetQuote, DeskAsset } from "@/lib/assets";
import type { TokenStats } from "@/lib/council-types";
import { fetchCandles, geckoPrices, isCrypto, isToken, TOKENS, type AssetKey, type Candle, type Prices, type Quote, type Token } from "@/lib/market";
import { assetCandles, assetQuote } from "../market/assets";
import { listedQuotes } from "../market/quotes";
import { stockCandles } from "../market/stocks";

/** The stock market as a whole, which a Stock Token's move is measured against. */
const BENCHMARK = "QQQ";

const pct = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** Wilder's RSI over closing prices. */
export function rsi(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  return values.slice(1).reduce((prev, v) => v * k + prev * (1 - k), values[0]);
}

/** Average true range over the last `period` candles, as a percent of price. */
function atrPct(candles: Candle[], period = 14): number {
  const recent = candles.slice(-(period + 1));
  const ranges = recent.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - recent[i].close), Math.abs(c.low - recent[i].close)));
  const last = candles[candles.length - 1].close;
  return last > 0 ? (avg(ranges) / last) * 100 : 0;
}

/** Change over the last hour of five-minute candles, in percent. */
const hourChange = (candles: Candle[]) => (candles.length ? pct(candles.slice(-12)[0].open, candles[candles.length - 1].close) : 0);

/** `candles` are five minutes apart, oldest first. */
function summarize(token: AssetKey, candles: Candle[], quote: Pick<Quote, "change24h" | "high24h" | "low24h"> | undefined, hasVolume: boolean): TokenStats {
  const last = candles[candles.length - 1];
  const closes = candles.map((c) => c.close);
  const back = (n: number) => candles[Math.max(0, candles.length - n)];
  const hour = candles.slice(-12);
  const fast = ema(closes.slice(-40), 9);
  const slow = ema(closes.slice(-40), 26);
  const gap = pct(slow, fast);
  const high24h = quote?.high24h ?? Math.max(...candles.map((c) => c.high));
  const low24h = quote?.low24h ?? Math.min(...candles.map((c) => c.low));
  const recentVol = avg(candles.slice(-3).map((c) => c.volume));
  const baseVol = avg(candles.slice(-27, -3).map((c) => c.volume));

  return {
    token,
    price: last.close,
    change24h: quote?.change24h ?? 0,
    change1h: pct(hour[0].open, last.close),
    change15m: pct(back(3).open, last.close),
    change4h: pct(back(48).open, last.close),
    rsi14: Math.round(rsi(closes)),
    volRatio: hasVolume && baseVol > 0 ? round(recentVol / baseVol, 1) : null,
    trend: gap > 0.08 ? "up" : gap < -0.08 ? "down" : "flat",
    atrPct: round(atrPct(candles)),
    rangePos: high24h > low24h ? Math.round(Math.min(Math.max((last.close - low24h) / (high24h - low24h), 0), 1) * 100) : 50,
    vsMarket1h: null,
    high1h: Math.max(...hour.map((c) => c.high)),
    low1h: Math.min(...hour.map((c) => c.low)),
  };
}

/** Turns CoinGecko's five-minute price points into flat candles with no volume. */
const fromPrices = (points: Array<{ time: number; price: number }>): Candle[] =>
  points.map((p, i) => {
    const open = points[i - 1]?.price ?? p.price;
    return { time: p.time, open, high: Math.max(open, p.price), low: Math.min(open, p.price), close: p.price, volume: 0 };
  });

async function series(token: Token): Promise<{ candles: Candle[]; hasVolume: boolean }> {
  // A session can wait a few seconds for a Stock Token's history. Without it the token can't be discussed.
  if (!isCrypto(token)) return { candles: await stockCandles(token, "5m", 60, true), hasVolume: true };
  const signal = AbortSignal.timeout(20_000);
  try {
    return { candles: await fetchCandles(token, "5m", 60, signal), hasVolume: true };
  } catch {
    return { candles: fromPrices(await geckoPrices(token, signal)).slice(-60), hasVolume: false };
  }
}

/** How far the stock market as a whole moved in the last hour, in percent. Zero if it can't be read. */
export const benchmarkChange = () =>
  stockCandles(BENCHMARK, "5m", 60)
    .then(hourChange)
    .catch(() => 0);

export interface Board {
  stats: TokenStats[];
  /** The stock market's move over the last hour, which Stock Tokens are measured against. */
  market1h: number;
}

/** The same real numbers every agent sees: price, momentum, trend, volatility and volume for each listed token. */
export async function fetchBoard(): Promise<Board> {
  const [quotes, market1h, ...all] = await Promise.all([listedQuotes(), benchmarkChange(), ...TOKENS.map((t) => series(t).catch(() => null))]);
  const stats = TOKENS.flatMap((t, i): TokenStats[] => {
    const s = all[i];
    const quote = quotes[t];
    if (!s || s.candles.length < 30 || !quote) return [];
    const stock = !isCrypto(t);
    return [{ ...summarize(t, s.candles, quote, s.hasVolume), price: quote.price, vsMarket1h: stock ? round(hourChange(s.candles) - market1h) : null, session: quote.session }];
  });
  return { stats, market1h };
}

export const fetchStats = async () => (await fetchBoard()).stats;

/** The same figures for a token a funder asked for. Null if it has too little history to read. */
export async function assetStats(asset: Asset, quote: AssetQuote, market1h: number): Promise<TokenStats | null> {
  const candles = await assetCandles(asset, "5m", 60, true);
  if (candles.length < 30) return null;
  // The latest trade can be minutes old. The quote is the price an order would get now.
  const last = candles[candles.length - 1];
  const live = [...candles.slice(0, -1), { ...last, close: quote.price, high: Math.max(last.high, quote.price), low: Math.min(last.low, quote.price) }];
  const s = summarize(asset.key, live, { change24h: quote.change24h }, true);
  return {
    ...s,
    vsMarket1h: asset.kind === "stock" ? round(s.change1h - market1h) : null,
    session: quote.session,
    name: asset.name,
    pool: asset.kind === "pool" ? { liquidityUsd: quote.liquidityUsd ?? 0, volume24hUsd: quote.volume24hUsd } : undefined,
  };
}

type Assets = Record<AssetKey, DeskAsset>;

export async function fetchPrice(token: AssetKey, assets: Assets = {}): Promise<number> {
  if (!isToken(token)) {
    const asset = assets[token];
    if (!asset) throw new Error(`No live price for ${token}`);
    return (await assetQuote(asset)).price;
  }
  const quote = (await listedQuotes())[token];
  if (!quote) throw new Error(`No live price for ${token}`);
  return quote.price;
}

/** Fresh quotes for the requested tokens the desk holds. One that can't be reached keeps its last quote. */
export async function refreshAssets(assets: Assets, held: AssetKey[]): Promise<Assets> {
  const wanted = held.filter((k) => assets[k]);
  if (wanted.length === 0) return assets;
  const quotes = await Promise.all(wanted.map((k) => assetQuote(assets[k]).catch(() => null)));
  const out = { ...assets };
  wanted.forEach((k, i) => {
    const quote = quotes[i];
    if (quote) out[k] = { ...assets[k], quote, quotedAt: Date.now() };
  });
  return out;
}

/**
 * The price of everything the desk can hold: listed tokens, and the requested tokens it holds.
 * Throws if the listed tokens can't be quoted.
 */
export async function deskPrices(state: { assets: Assets; portfolio: { positions: Array<{ token: AssetKey }> } }): Promise<Prices> {
  const held = state.portfolio.positions.map((p) => p.token).filter((t) => !isToken(t));
  const [quotes, assets] = await Promise.all([listedQuotes(), refreshAssets(state.assets, held)]);
  const prices: Prices = Object.fromEntries(Object.entries(quotes).map(([t, q]) => [t, q.price]));
  for (const k of held) if (assets[k]) prices[k] = assets[k].quote.price;
  return prices;
}

/**
 * One-minute candles since `sinceMs`, used to decide whether a stop or target was touched.
 * Empty for a token whose market is closed, since its price can't have moved.
 */
export async function extremesSince(token: AssetKey, sinceMs: number, nowMs: number, assets: Assets = {}): Promise<Candle[]> {
  const minutes = Math.min(Math.ceil((nowMs - sinceMs) / 60_000) + 1, 1000);
  if (!isToken(token)) return assets[token] ? assetCandles(assets[token], "1m", minutes) : [];
  if (!isCrypto(token)) return stockCandles(token, "1m", minutes);
  const signal = AbortSignal.timeout(10_000);
  try {
    return await fetchCandles(token, "1m", minutes, signal);
  } catch {
    return fromPrices(await geckoPrices(token, signal));
  }
}
