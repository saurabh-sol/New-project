/**
 * Real market data from Binance's public, keyless market-data endpoints.
 * Spot USDT pairs are used as the reference price for each token.
 */

export const TOKENS = ["SOL", "JUP", "BONK", "WIF", "JTO", "PYTH"] as const;
export type Token = (typeof TOKENS)[number];

export const INTERVALS = ["1m", "5m", "15m", "1h"] as const;
export type Interval = (typeof INTERVALS)[number];

export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

export interface Candle {
  time: number; // candle open, unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  price: number;
  change24h: number; // percent
}

const REST = "https://data-api.binance.vision/api/v3";
const WS = "wss://data-stream.binance.vision/ws";

const pair = (token: string) => `${token}USDT`;
export const isToken = (t: string): t is Token => (TOKENS as readonly string[]).includes(t);

type RawKline = [number, string, string, string, string, string, ...unknown[]];

const toCandle = (k: RawKline): Candle => ({
  time: Math.floor(k[0] / 1000),
  open: +k[1],
  high: +k[2],
  low: +k[3],
  close: +k[4],
  volume: +k[5],
});

export async function fetchCandles(token: Token, interval: Interval, limit = 300, signal?: AbortSignal): Promise<Candle[]> {
  const res = await fetch(`${REST}/klines?symbol=${pair(token)}&interval=${interval}&limit=${limit}`, { signal });
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  return ((await res.json()) as RawKline[]).map(toCandle);
}

export async function fetchQuotes(signal?: AbortSignal): Promise<Partial<Record<Token, Quote>>> {
  const symbols = encodeURIComponent(JSON.stringify(TOKENS.map(pair)));
  const res = await fetch(`${REST}/ticker/24hr?symbols=${symbols}`, { signal });
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  const rows = (await res.json()) as Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>;
  const out: Partial<Record<Token, Quote>> = {};
  for (const r of rows) {
    const token = r.symbol.replace(/USDT$/, "");
    if (isToken(token)) out[token] = { price: +r.lastPrice, change24h: +r.priceChangePercent };
  }
  return out;
}

/**
 * Streams the live (still forming) candle. Reconnects on drop. Returns an unsubscribe function.
 */
export function subscribeCandles(token: Token, interval: Interval, onCandle: (c: Candle) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(`${WS}/${pair(token).toLowerCase()}@kline_${interval}`);
    ws.onopen = () => {
      attempts = 0;
    };
    ws.onmessage = (ev) => {
      const k = (JSON.parse(ev.data as string) as { k?: { t: number; o: string; h: string; l: string; c: string; v: string } }).k;
      if (!k) return;
      onCandle({ time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v });
    };
    ws.onclose = () => {
      if (closed) return;
      retry = setTimeout(open, Math.min(1000 * 2 ** attempts++, 15000));
    };
    ws.onerror = () => ws?.close();
  };
  open();

  return () => {
    closed = true;
    clearTimeout(retry);
    ws?.close();
  };
}

/** Decimal places that keep ~5 significant digits, so BONK and SOL both read well. */
export function priceDecimals(price: number): number {
  if (!isFinite(price) || price <= 0) return 2;
  return Math.min(Math.max(2, 4 - Math.floor(Math.log10(price))), 10);
}
