import type { TokenStats } from "@/lib/council-types";
import { fetchCandles, fetchQuotes, geckoPrices, TOKENS, type Candle, type Quote, type Token } from "@/lib/market";

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

/** `candles` are five minutes apart, oldest first. */
function summarize(token: Token, candles: Candle[], quote: Quote | undefined, hasVolume: boolean): TokenStats {
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
    rangePos: high24h > low24h ? Math.round(((last.close - low24h) / (high24h - low24h)) * 100) : 50,
    vsSol1h: 0,
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

async function series(token: Token, signal: AbortSignal): Promise<{ candles: Candle[]; hasVolume: boolean }> {
  try {
    return { candles: await fetchCandles(token, "5m", 60, signal), hasVolume: true };
  } catch {
    return { candles: fromPrices(await geckoPrices(token, signal)).slice(-60), hasVolume: false };
  }
}

/** The same real numbers every agent sees: price, momentum, trend, volatility and volume for each token. */
export async function fetchStats(): Promise<TokenStats[]> {
  const signal = AbortSignal.timeout(20_000);
  const [quotes, ...all] = await Promise.all([fetchQuotes(signal), ...TOKENS.map((t) => series(t, signal).catch(() => null))]);
  const stats = TOKENS.flatMap((t, i) => {
    const s = all[i];
    return s && s.candles.length >= 30 ? [summarize(t, s.candles, quotes[t], s.hasVolume)] : [];
  });
  const sol = stats.find((s) => s.token === "SOL")?.change1h ?? 0;
  return stats.map((s) => ({ ...s, vsSol1h: round(s.change1h - sol) }));
}

export async function fetchPrice(token: Token): Promise<number> {
  const quote = (await fetchQuotes(AbortSignal.timeout(10_000)))[token];
  if (!quote) throw new Error(`No live price for ${token}`);
  return quote.price;
}

/**
 * Lowest and highest price seen since `sinceMs`, with the time each was reached.
 * Used to decide whether a stop or target was touched.
 */
export async function extremesSince(token: Token, sinceMs: number, nowMs: number): Promise<Candle[]> {
  const signal = AbortSignal.timeout(10_000);
  const minutes = Math.min(Math.ceil((nowMs - sinceMs) / 60_000) + 1, 1000);
  try {
    return await fetchCandles(token, "1m", minutes, signal);
  } catch {
    return fromPrices(await geckoPrices(token, signal));
  }
}
