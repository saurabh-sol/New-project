import type { TokenStats } from "@/lib/council-types";
import { fetchCandles, fetchQuotes, TOKENS, type Candle, type Token } from "@/lib/market";

const pct = (from: number, to: number) => (from > 0 ? ((to - from) / from) * 100 : 0);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

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

function summarize(token: Token, candles: Candle[], change24h: number): TokenStats {
  const last = candles[candles.length - 1];
  const hour = candles.slice(-12);
  const recentVol = avg(candles.slice(-3).map((c) => c.volume));
  const baseVol = avg(candles.slice(-27, -3).map((c) => c.volume));
  return {
    token,
    price: last.close,
    change24h,
    change1h: pct(hour[0].open, last.close),
    rsi14: Math.round(rsi(candles.map((c) => c.close))),
    volRatio: baseVol > 0 ? Math.round((recentVol / baseVol) * 10) / 10 : 1,
    high1h: Math.max(...hour.map((c) => c.high)),
    low1h: Math.min(...hour.map((c) => c.low)),
  };
}

/** The same real numbers every agent sees: price, momentum, RSI and volume for each token. */
export async function fetchStats(): Promise<TokenStats[]> {
  const signal = AbortSignal.timeout(15_000);
  const [quotes, ...series] = await Promise.all([fetchQuotes(signal), ...TOKENS.map((t) => fetchCandles(t, "5m", 60, signal))]);
  return TOKENS.flatMap((t, i) => (series[i].length >= 30 ? [summarize(t, series[i], quotes[t]?.change24h ?? 0)] : []));
}

export async function fetchPrice(token: Token): Promise<number> {
  const quote = (await fetchQuotes(AbortSignal.timeout(10_000)))[token];
  if (!quote) throw new Error(`No live price for ${token}`);
  return quote.price;
}
