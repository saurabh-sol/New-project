/**
 * Robinhood Stock Tokens.
 *
 * Live prices and the list of tokens come from Robinhood's Stock Token API, which is public.
 * Robinhood publishes no price history, so candles are the underlying share's, read from
 * Yahoo Finance's public chart data and scaled to the token's price.
 */
import { stockSession, type Candle, type Interval, type Session } from "@/lib/market";
import { cached, getJson } from "./http";

const ROBINHOOD = "https://api.robinhood.com/rhj";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart";
const MAINNET = 4663;

export interface StockToken {
  symbol: string;
  name: string;
  /** Contract address on Robinhood Chain. */
  address: string;
  /** Shares one token stands for. Rises as dividends are reinvested. */
  multiplier: number;
  active: boolean;
}

export interface StockQuote {
  /** Price of one token in USD: the middle of what buyers bid and sellers ask. */
  price: number;
  /** Percent against the previous close. */
  change: number;
  high: number;
  low: number;
  /** Value of the shares traded today, in USD. */
  volumeUsd: number;
  halted: boolean;
  session: Session;
}

interface RawAsset {
  tokenSymbol: string;
  tokenName: string;
  deployments: Array<{ contractAddress: string; chainId: number }>;
  currentMultiplier: string;
  status: string;
}

interface RawQuote {
  tokenSymbol: string;
  bid: string;
  ask: string;
  tokenBid?: string;
  tokenAsk?: string;
  dailyHigh?: string;
  dailyLow?: string;
  dailyTradingVolume: string;
  isTradingHalt: boolean;
}

/** Every Stock Token on Robinhood Chain, by symbol. */
export function stockTokens(): Promise<Map<string, StockToken>> {
  return cached("stocks:assets", 10 * 60_000, async () => {
    const { assets } = await getJson<{ assets: RawAsset[] }>(`${ROBINHOOD}/assets`);
    const out = new Map<string, StockToken>();
    for (const a of assets) {
      const address = a.deployments.find((d) => d.chainId === MAINNET)?.contractAddress;
      if (!address) continue;
      out.set(a.tokenSymbol.toUpperCase(), {
        symbol: a.tokenSymbol.toUpperCase(),
        name: a.tokenName.replace(/\s*•\s*Robinhood Token$/i, ""),
        address,
        multiplier: Number(a.currentMultiplier) || 1,
        active: a.status === "ASSET_STATUS_ACTIVE",
      });
    }
    return out;
  });
}

/** The Stock Token with this symbol or contract address, if there is one. */
export async function findStock(query: string): Promise<StockToken | null> {
  const tokens = await stockTokens();
  const q = query.trim();
  const bySymbol = tokens.get(q.replace(/^\$/, "").toUpperCase());
  if (bySymbol) return bySymbol;
  return [...tokens.values()].find((t) => t.address.toLowerCase() === q.toLowerCase()) ?? null;
}

const live = () =>
  cached("stocks:prices", 10_000, async () => {
    const { quotes } = await getJson<{ quotes: RawQuote[] }>(`${ROBINHOOD}/prices`);
    return new Map(quotes.map((q) => [q.tokenSymbol.toUpperCase(), q]));
  });

interface YahooChart {
  chart: {
    result?: Array<{
      meta: { previousClose?: number; chartPreviousClose?: number };
      timestamp?: number[];
      indicators: { quote: Array<{ open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[]; volume: (number | null)[] }> };
    }>;
  };
}

// Yahoo writes share classes with a dash: BRK.B is BRK-B.
const ticker = (symbol: string) => encodeURIComponent(symbol.replace(/\./g, "-"));

const STEP: Record<Interval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
const SPAN: Record<Interval, { interval: string; range: string; freshMs: number }> = {
  "1m": { interval: "1m", range: "2d", freshMs: 40_000 },
  "5m": { interval: "5m", range: "5d", freshMs: 90_000 },
  "15m": { interval: "15m", range: "5d", freshMs: 180_000 },
  "1h": { interval: "60m", range: "1mo", freshMs: 300_000 },
};

const history = (symbol: string, span: Interval, patient = false) =>
  cached(`stocks:candles:${symbol}:${span}`, SPAN[span].freshMs, async () => {
    const { interval, range } = SPAN[span];
    const body = await getJson<YahooChart>(`${YAHOO}/${ticker(symbol)}?interval=${interval}&range=${range}&includePrePost=true`, patient);
    const r = body.chart.result?.[0];
    if (!r?.timestamp) throw new Error(`No price history for ${symbol}`);
    const q = r.indicators.quote[0];
    const step = STEP[span];
    const candles: Candle[] = [];
    r.timestamp.forEach((at, i) => {
      const [open, high, low, close] = [q.open[i], q.high[i], q.low[i], q.close[i]];
      if (open === null || high === null || low === null || close === null) return;
      // The last entry is the latest trade, stamped with its own time. It belongs to the candle it falls in.
      const time = Math.floor(at / step) * step;
      const prev = candles[candles.length - 1];
      if (prev?.time === time) candles[candles.length - 1] = { ...prev, high: Math.max(prev.high, high), low: Math.min(prev.low, low), close, volume: prev.volume + (q.volume[i] ?? 0) };
      else candles.push({ time, open, high, low, close, volume: q.volume[i] ?? 0 });
    });
    return { candles, previousClose: r.meta.previousClose ?? r.meta.chartPreviousClose ?? null };
  });

/** Live quotes for the named Stock Tokens. One that can't be quoted is left out. */
export async function stockQuotes(symbols: string[]): Promise<Record<string, StockQuote>> {
  if (symbols.length === 0) return {};
  const [tokens, quotes, closes] = await Promise.all([
    stockTokens(),
    live(),
    // The previous close changes once a day. A symbol whose history can't be read shows no change.
    Promise.all(symbols.map((s) => history(s, "5m").then((h) => h.previousClose).catch(() => null))),
  ]);
  const session = stockSession();
  const out: Record<string, StockQuote> = {};
  symbols.forEach((symbol, i) => {
    const q = quotes.get(symbol);
    const multiplier = tokens.get(symbol)?.multiplier ?? 1;
    if (!q) return;
    const bid = Number(q.tokenBid) || Number(q.bid) * multiplier;
    const ask = Number(q.tokenAsk) || Number(q.ask) * multiplier;
    const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
    if (!(price > 0)) return;
    const previous = closes[i];
    out[symbol] = {
      price,
      change: previous ? ((price / multiplier - previous) / previous) * 100 : 0,
      high: (Number(q.dailyHigh) || price / multiplier) * multiplier,
      low: (Number(q.dailyLow) || price / multiplier) * multiplier,
      volumeUsd: Number(q.dailyTradingVolume) * (price / multiplier),
      halted: q.isTradingHalt,
      session: q.isTradingHalt ? "closed" : session,
    };
  });
  return out;
}

/**
 * The latest `limit` candles of a Stock Token, oldest first, in the token's price.
 * Share prices are scaled by the token's multiplier. When the last candle is older than the
 * live price, as it is overnight, the live price is added as the newest candle.
 */
export async function stockCandles(symbol: string, span: Interval, limit: number, patient = false): Promise<Candle[]> {
  const step = STEP[span];
  const [{ candles }, tokens, quotes] = await Promise.all([history(symbol, span, patient), stockTokens(), stockQuotes([symbol]).catch(() => ({}) as Record<string, StockQuote>)]);
  const m = tokens.get(symbol)?.multiplier ?? 1;
  const scaled = candles.map((c) => ({ ...c, open: c.open * m, high: c.high * m, low: c.low * m, close: c.close * m }));

  const quote = quotes[symbol];
  const last = scaled[scaled.length - 1];
  if (quote && last && quote.session !== "closed") {
    const slot = Math.floor(Date.now() / 1000 / step) * step;
    if (slot > last.time) scaled.push({ time: slot, open: last.close, high: Math.max(last.close, quote.price), low: Math.min(last.close, quote.price), close: quote.price, volume: 0 });
    else scaled[scaled.length - 1] = { ...last, close: quote.price, high: Math.max(last.high, quote.price), low: Math.min(last.low, quote.price) };
  }
  return scaled.slice(-limit);
}
