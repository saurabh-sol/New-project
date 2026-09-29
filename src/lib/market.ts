/**
 * Real market data. Binance's public spot endpoints are the primary source
 * (USDT pairs); CoinGecko is the backup when Binance can't be reached.
 * Neither needs an API key.
 */

export const TOKENS = ["SOL", "JUP", "BONK", "WIF", "JTO", "PYTH"] as const;
export type Token = (typeof TOKENS)[number];

/**
 * Names any asset the desk can hold: a listed token's symbol ("SOL"), or a key made for a
 * token a funder asked for by contract address.
 */
export type AssetKey = string;

/** Latest price of each asset. An asset with no live price is simply absent. */
export type Prices = Record<AssetKey, number | undefined>;

export const INTERVALS = ["1m", "5m", "15m", "1h"] as const;
export type Interval = (typeof INTERVALS)[number];

export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

export type PriceSource = "binance" | "coingecko";

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
  high24h?: number;
  low24h?: number;
}

const BINANCE = "https://data-api.binance.vision/api/v3";
const BINANCE_WS = "wss://data-stream.binance.vision/ws";
const COINGECKO = "https://api.coingecko.com/api/v3";

const GECKO_ID: Record<Token, string> = {
  SOL: "solana",
  JUP: "jupiter-exchange-solana",
  BONK: "bonk",
  WIF: "dogwifcoin",
  JTO: "jito-governance-token",
  PYTH: "pyth-network",
};

/** Mint address of each listed token on Solana. */
export const MINTS: Record<Token, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
  PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
};

const pair = (token: string) => `${token}USDT`;
export const isToken = (t: string): t is Token => (TOKENS as readonly string[]).includes(t);

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  return (await res.json()) as T;
}

// --- Binance ---

type RawKline = [number, string, string, string, string, string, ...unknown[]];

const toCandle = (k: RawKline): Candle => ({
  time: Math.floor(k[0] / 1000),
  open: +k[1],
  high: +k[2],
  low: +k[3],
  close: +k[4],
  volume: +k[5],
});

/** Candles from Binance. Throws if Binance can't be reached. */
export async function fetchCandles(token: Token, interval: Interval, limit = 300, signal?: AbortSignal): Promise<Candle[]> {
  const rows = await getJson<RawKline[]>(`${BINANCE}/klines?symbol=${pair(token)}&interval=${interval}&limit=${limit}`, signal);
  return rows.map(toCandle);
}

async function binanceQuotes(signal?: AbortSignal): Promise<Partial<Record<Token, Quote>>> {
  const symbols = encodeURIComponent(JSON.stringify(TOKENS.map(pair)));
  const rows = await getJson<Array<{ symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string }>>(
    `${BINANCE}/ticker/24hr?symbols=${symbols}`,
    signal,
  );
  const out: Partial<Record<Token, Quote>> = {};
  for (const r of rows) {
    const token = r.symbol.replace(/USDT$/, "");
    if (isToken(token)) out[token] = { price: +r.lastPrice, change24h: +r.priceChangePercent, high24h: +r.highPrice, low24h: +r.lowPrice };
  }
  return out;
}

// --- CoinGecko ---

async function geckoQuotes(signal?: AbortSignal): Promise<Partial<Record<Token, Quote>>> {
  const ids = TOKENS.map((t) => GECKO_ID[t]).join(",");
  const rows = await getJson<Record<string, { usd: number; usd_24h_change: number }>>(
    `${COINGECKO}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    signal,
  );
  const out: Partial<Record<Token, Quote>> = {};
  for (const t of TOKENS) {
    const r = rows[GECKO_ID[t]];
    if (r) out[t] = { price: r.usd, change24h: r.usd_24h_change };
  }
  return out;
}

/** One day of 30-minute candles. CoinGecko's free tier offers nothing finer, and no volume. */
async function geckoCandles(token: Token, signal?: AbortSignal): Promise<Candle[]> {
  const rows = await getJson<Array<[number, number, number, number, number]>>(`${COINGECKO}/coins/${GECKO_ID[token]}/ohlc?vs_currency=usd&days=1`, signal);
  return rows.map(([ms, open, high, low, close]) => ({ time: Math.floor(ms / 1000) - 1800, open, high, low, close, volume: 0 }));
}

/** One day of prices about five minutes apart, newest last. */
export async function geckoPrices(token: Token, signal?: AbortSignal): Promise<Array<{ time: number; price: number }>> {
  const rows = await getJson<{ prices: Array<[number, number]> }>(`${COINGECKO}/coins/${GECKO_ID[token]}/market_chart?vs_currency=usd&days=1`, signal);
  return rows.prices.map(([ms, price]) => ({ time: Math.floor(ms / 1000), price }));
}

// --- with fallback ---

export async function fetchQuotesFrom(signal?: AbortSignal): Promise<{ quotes: Partial<Record<Token, Quote>>; source: PriceSource }> {
  try {
    return { quotes: await binanceQuotes(signal), source: "binance" };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { quotes: await geckoQuotes(signal), source: "coingecko" };
  }
}

export const fetchQuotes = async (signal?: AbortSignal) => (await fetchQuotesFrom(signal)).quotes;

export interface ChartData {
  candles: Candle[];
  source: PriceSource;
  /** Seconds per candle actually returned, which differs from the request on the backup source. */
  step: number;
}

export async function fetchChart(token: Token, interval: Interval, limit = 300, signal?: AbortSignal): Promise<ChartData> {
  try {
    return { candles: await fetchCandles(token, interval, limit, signal), source: "binance", step: INTERVAL_SECONDS[interval] };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { candles: await geckoCandles(token, signal), source: "coingecko", step: 1800 };
  }
}

/**
 * Streams the live (still forming) candle from Binance. Reconnects on drop.
 * Returns an unsubscribe function.
 */
export function subscribeCandles(token: Token, interval: Interval, onCandle: (c: Candle) => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(`${BINANCE_WS}/${pair(token).toLowerCase()}@kline_${interval}`);
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
