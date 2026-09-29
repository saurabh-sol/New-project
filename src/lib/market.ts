/**
 * Market data the browser can read for itself, and the tokens the desk used to list.
 *
 * The agents trade the tokens trending on Robinhood Chain, which the server names for each
 * session. ETH and the Stock Tokens below are what the desk listed before. It no longer buys
 * them, and they are priced here for as long as it still holds one: ETH on Binance's public
 * feed, Stock Tokens by the server from Robinhood's Stock Token API.
 */

export const TOKENS = ["ETH", "TSLA", "NVDA", "AAPL", "AMZN", "PLTR"] as const;
export type Token = (typeof TOKENS)[number];

/** Listed tokens that are crypto assets. They trade every hour of every day. */
const CRYPTO: readonly string[] = ["ETH"];

/** Contract address of each listed token on Robinhood Chain. ETH is held as wrapped ETH. */
export const ADDRESSES: Record<Token, string> = {
  ETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  TSLA: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d",
  NVDA: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
  AAPL: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
  AMZN: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
  PLTR: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A",
};

/**
 * Names any asset the desk can hold: a listed token's symbol ("TSLA"), or a key made for a
 * token a funder asked for.
 */
export type AssetKey = string;

/** Latest price of each asset. An asset with no live price is simply absent. */
export type Prices = Record<AssetKey, number | undefined>;

export const INTERVALS = ["1m", "5m", "15m", "1h"] as const;
export type Interval = (typeof INTERVALS)[number];
export const isInterval = (v: unknown): v is Interval => typeof v === "string" && (INTERVALS as readonly string[]).includes(v);

export const INTERVAL_SECONDS: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };

export interface Candle {
  time: number; // candle open, unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * When a Stock Token can be traded. Stock Tokens trade around the clock from Sunday evening
 * to Friday evening, New York time, and not at the weekend.
 */
export type Session = "regular" | "extended" | "overnight" | "closed";

export interface Quote {
  price: number;
  change24h: number; // percent; for a Stock Token, against the previous close
  high24h?: number;
  low24h?: number;
  /** Set for Stock Tokens. Crypto is always open. */
  session?: Session;
  /** For a token priced by its pool: its change over the last five minutes and the last hour, in percent. */
  change5m?: number;
  change1h?: number;
}

export const isToken = (t: string): t is Token => (TOKENS as readonly string[]).includes(t);
export const isCrypto = (t: string) => CRYPTO.includes(t);

const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" });

/** The Stock Token session at a given moment. Market holidays are not accounted for. */
export function stockSession(at = new Date()): Session {
  const parts = Object.fromEntries(NEW_YORK.formatToParts(at).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const day = parts.weekday;
  const evening = 20 * 60;
  if (day === "Sat" || (day === "Fri" && minutes >= evening) || (day === "Sun" && minutes < evening)) return "closed";
  if (day === "Sun") return "overnight";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "regular";
  if (minutes >= 4 * 60 && minutes < evening) return "extended";
  return "overnight";
}

export const SESSION_LABEL: Record<Session, string> = {
  regular: "Market open",
  extended: "Extended hours",
  overnight: "Overnight session",
  closed: "Closed for the weekend",
};

const BINANCE = "https://data-api.binance.vision/api/v3";
const BINANCE_WS = "wss://data-stream.binance.vision/ws";
const COINGECKO = "https://api.coingecko.com/api/v3";
const GECKO_ID: Record<string, string> = { ETH: "ethereum" };

const pair = (token: string) => `${token}USDT`;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  return (await res.json()) as T;
}

// --- crypto: Binance, with CoinGecko as the backup ---

type RawKline = [number, string, string, string, string, string, ...unknown[]];

const toCandle = (k: RawKline): Candle => ({
  time: Math.floor(k[0] / 1000),
  open: +k[1],
  high: +k[2],
  low: +k[3],
  close: +k[4],
  volume: +k[5],
});

/** Candles of a crypto token from Binance. Throws if Binance can't be reached. */
export async function fetchCandles(token: string, interval: Interval, limit = 300, signal?: AbortSignal): Promise<Candle[]> {
  const rows = await getJson<RawKline[]>(`${BINANCE}/klines?symbol=${pair(token)}&interval=${interval}&limit=${limit}`, signal);
  return rows.map(toCandle);
}

/** One day of prices about five minutes apart, newest last. */
export async function geckoPrices(token: string, signal?: AbortSignal): Promise<Array<{ time: number; price: number }>> {
  const rows = await getJson<{ prices: Array<[number, number]> }>(`${COINGECKO}/coins/${GECKO_ID[token]}/market_chart?vs_currency=usd&days=1`, signal);
  return rows.prices.map(([ms, price]) => ({ time: Math.floor(ms / 1000), price }));
}

async function binanceQuotes(tokens: string[], signal?: AbortSignal): Promise<Record<string, Quote>> {
  const symbols = encodeURIComponent(JSON.stringify(tokens.map(pair)));
  const rows = await getJson<Array<{ symbol: string; lastPrice: string; priceChangePercent: string; highPrice: string; lowPrice: string }>>(
    `${BINANCE}/ticker/24hr?symbols=${symbols}`,
    signal,
  );
  return Object.fromEntries(rows.map((r) => [r.symbol.replace(/USDT$/, ""), { price: +r.lastPrice, change24h: +r.priceChangePercent, high24h: +r.highPrice, low24h: +r.lowPrice }]));
}

async function geckoQuotes(tokens: string[], signal?: AbortSignal): Promise<Record<string, Quote>> {
  const ids = tokens.map((t) => GECKO_ID[t]).join(",");
  const rows = await getJson<Record<string, { usd: number; usd_24h_change: number }>>(`${COINGECKO}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`, signal);
  const out: Record<string, Quote> = {};
  for (const t of tokens) {
    const r = rows[GECKO_ID[t]];
    if (r) out[t] = { price: r.usd, change24h: r.usd_24h_change };
  }
  return out;
}

/** Quotes for the listed crypto tokens. */
export async function cryptoQuotes(signal?: AbortSignal): Promise<Record<string, Quote>> {
  const tokens = TOKENS.filter(isCrypto);
  try {
    return await binanceQuotes(tokens, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    return geckoQuotes(tokens, signal);
  }
}

/**
 * Streams the live (still forming) candle of a crypto token from Binance. Reconnects on drop.
 * Returns an unsubscribe function.
 */
export function subscribeCandles(token: string, interval: Interval, onCandle: (c: Candle) => void): () => void {
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

// --- everything, through this app's own server ---

/** Quotes for the tokens on the desk's board and the tokens it holds. */
export async function fetchQuotes(signal?: AbortSignal): Promise<Record<AssetKey, Quote>> {
  const res = await fetch("/api/market/quotes", { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Market data request failed (${res.status})`);
  return ((await res.json()) as { quotes: Record<AssetKey, Quote> }).quotes;
}

/** Candles of any token that isn't crypto. */
export async function fetchServerCandles(token: AssetKey, interval: Interval, signal?: AbortSignal): Promise<Candle[]> {
  const res = await fetch(`/api/market/candles?token=${encodeURIComponent(token)}&interval=${interval}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error("Candles unavailable");
  return ((await res.json()) as { candles: Candle[] }).candles;
}

/** Decimal places that keep ~5 significant digits, so a fraction of a cent and a share price both read well. */
export function priceDecimals(price: number): number {
  if (!isFinite(price) || price <= 0) return 2;
  return Math.min(Math.max(2, 4 - Math.floor(Math.log10(price))), 10);
}
