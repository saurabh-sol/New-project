/**
 * Tokens on Robinhood Chain that a funder may ask for: any token that has a live price.
 *
 * A Robinhood Stock Token is priced by Robinhood. Any other token is priced by its most
 * liquid trading pool: DexScreener supplies the price and liquidity, GeckoTerminal the candles.
 * A token DexScreener has no price for is priced by GeckoTerminal. None of these needs a key.
 */
import { createPublicClient, http, parseAbi } from "viem";
import { robinhood } from "viem/chains";
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

/** The desk's own money, on the mainnet that prices come from. */
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

/**
 * A pool token must clear these before an agent will be asked to trade it.
 * With test money any token may be asked for, so long as it traded in the last day and its
 * price is therefore a live one. With real money the desk keeps to established markets.
 */
export function requestLimits() {
  const real = process.env.ROBINHOOD_NETWORK === "mainnet";
  return {
    minLiquidityUsd: num(process.env.REQUEST_MIN_LIQUIDITY_USD, real ? 50_000 : 0),
    minVolumeUsd: num(process.env.REQUEST_MIN_VOLUME_USD, real ? 10_000 : 100),
    minAgeHours: num(process.env.REQUEST_MIN_AGE_HOURS, real ? 24 : 0),
  };
}

interface Pair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { m5?: number; h1?: number; h24?: number };
  txns?: { m5?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
}

const poolQuote = (p: Pair): AssetQuote => ({
  price: Number(p.priceUsd ?? 0),
  change24h: p.priceChange?.h24 ?? 0,
  liquidityUsd: p.liquidity?.usd ?? 0,
  volume24hUsd: p.volume?.h24 ?? 0,
  change5m: p.priceChange?.m5,
  change1h: p.priceChange?.h1,
  buys5m: p.txns?.m5?.buys,
  sells5m: p.txns?.m5?.sells,
});

export const looksLikeAddress = (q: string) => /^0x[0-9a-fA-F]{40}$/.test(q);
const looksLikeSymbol = (q: string) => /^\$?[A-Za-z][A-Za-z.]{0,6}$/.test(q);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const cleanSymbol = (symbol: string) => symbol.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "TOKEN";

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

async function lookupStock(query: string): Promise<AssetPreview | null> {
  const stock = await findStock(query);
  if (!stock) return null;
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

// --- GeckoTerminal, for a token DexScreener has no price for ---

interface GeckoPool {
  id: string;
  attributes: { address: string; reserve_in_usd?: string; pool_created_at?: string; price_change_percentage?: { h24?: string }; volume_usd?: { h24?: string } };
  relationships: { base_token: { data: { id: string } } };
}
interface GeckoToken {
  data?: {
    attributes: { address: string; name: string; symbol: string; price_usd?: string | null };
    relationships?: { top_pools?: { data?: Array<{ id: string }> } };
  };
  included?: GeckoPool[];
}

const geckoToken = (address: string) =>
  getJson<GeckoToken>(`${GECKOTERMINAL}/tokens/${address.toLowerCase()}?include=top_pools`).catch((e) => {
    // The service answers "not found" for a token it has never seen trade.
    if (e instanceof Error && e.message.includes("(404)")) return {} as GeckoToken;
    throw e;
  });

/** The token's most liquid pool, and the token's quote as GeckoTerminal reports it. `pool` names the pool to read, when it is known. */
export async function geckoQuote(address: string, pool?: string): Promise<{ quote: AssetQuote; pool: GeckoPool; name: string; symbol: string } | null> {
  const found = await geckoToken(address);
  const token = found.data?.attributes;
  const pools = found.included ?? [];
  const top = (pool && pools.find((p) => same(p.attributes.address, pool))) || pools.find((p) => p.id === found.data?.relationships?.top_pools?.data?.[0]?.id) || pools[0];
  if (!token || !top || !(Number(token.price_usd) > 0)) return null;

  // A pool reports the change in the price of the token it is named after. For the other token of the pair, the candles say.
  const named = same(top.relationships.base_token.data.id.split("_")[1] ?? "", address);
  const change = named
    ? Number(top.attributes.price_change_percentage?.h24 ?? 0)
    : await poolCandles(top.attributes.address, address, "1h", 60)
        .then((c) => (c.length > 24 ? (c[c.length - 1].close / c[c.length - 25].close - 1) * 100 : 0))
        .catch(() => 0);
  return {
    pool: top,
    name: token.name,
    symbol: token.symbol,
    // Liquidity and volume are the pool's own. Summed over every pool a token is in, one bad pool spoils the figure.
    quote: { price: Number(token.price_usd), change24h: isFinite(change) ? change : 0, liquidityUsd: Number(top.attributes.reserve_in_usd ?? 0), volume24hUsd: Number(top.attributes.volume_usd?.h24 ?? 0) },
  };
}

// --- the chain itself, to tell a token nobody trades from an address that is not a token ---

const ERC20 = parseAbi(["function symbol() view returns (string)"]);
let mainnet: ReturnType<typeof createPublicClient> | undefined;

/** The symbol of the token at this address on Robinhood Chain, or null if there is no token there or the chain can't be reached. */
function symbolOnChain(address: string): Promise<string | null> {
  mainnet ??= createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_MAINNET_RPC_URL || undefined, { timeout: 6_000 }) });
  return mainnet
    .readContract({ address: address as `0x${string}`, abi: ERC20, functionName: "symbol" })
    .then((s) => cleanSymbol(String(s)))
    .catch(() => null);
}

async function lookupPool(address: string): Promise<AssetPreview> {
  if (same(address, USDG)) return { ok: false, error: "USDG is the money the desk trades with. Name a token for the agent to buy with it." };

  const pairs = (await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/tokens/${address}`)).pairs ?? [];
  const best = pairs
    .filter((p) => p.chainId === CHAIN && same(p.baseToken.address, address) && Number(p.priceUsd) > 0)
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

  let found: { quote: AssetQuote; asset: Omit<Asset, "key">; since: number | undefined };
  if (best) {
    found = { quote: poolQuote(best), since: best.pairCreatedAt, asset: { symbol: best.baseToken.symbol, name: best.baseToken.name, address: best.baseToken.address, kind: "pool", pool: best.pairAddress } };
  } else {
    const gecko = await geckoQuote(address);
    if (!gecko) {
      const symbol = await symbolOnChain(address);
      return { ok: false, error: symbol ? `${symbol} is a token on Robinhood Chain, but nobody trades it in a pool yet, so it has no price the agents could trade at.` : "No token that trades on Robinhood Chain was found at that address." };
    }
    const created = Date.parse(gecko.pool.attributes.pool_created_at ?? "");
    found = { quote: gecko.quote, since: isFinite(created) ? created : undefined, asset: { symbol: gecko.symbol, name: gecko.name, address, kind: "pool", pool: gecko.pool.attributes.address, feed: "gecko" } };
  }

  const symbol = found.asset.symbol.replace(/^\$/, "");
  const thin = tooThin(symbol, found.quote, found.since ? (Date.now() - found.since) / 3_600_000 : Infinity);
  if (thin) return { ok: false, error: thin };

  const asset = { ...found.asset, symbol };
  // Anyone can launch a token called TSLA. One that borrows a Stock Token's symbol must not be mistaken for it.
  const taken = isToken(cleanSymbol(symbol)) || (await stockTokens().catch(() => new Map())).has(cleanSymbol(symbol));
  return { ok: true, quote: found.quote, asset: { ...asset, key: taken ? longKey(asset) : cleanSymbol(symbol) } };
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
  if (asset.feed === "gecko") {
    return cached(`quote:gecko:${asset.address}`, 30_000, async () => {
      const found = await geckoQuote(asset.address, asset.pool);
      if (!found) throw new Error(`No live price for ${asset.symbol}`);
      return found.quote;
    });
  }
  return cached(`quote:${asset.pool}`, 10_000, async () => {
    const { pairs } = await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/pairs/${CHAIN}/${asset.pool}`);
    const pair = pairs?.[0];
    if (!pair || !(Number(pair.priceUsd) > 0)) throw new Error(`No live price for ${asset.symbol}`);
    return poolQuote(pair);
  });
}

/** DexScreener prices this many pools in one request. */
const BATCH = 30;

/**
 * Quotes for many tokens at once, by key. Pool tokens are priced together in one request, so
 * a board of them can be priced every few seconds. A token that can't be quoted is left out.
 */
export async function assetQuotes(assets: Asset[]): Promise<Record<string, AssetQuote>> {
  const out: Record<string, AssetQuote> = {};
  const together = assets.filter((a) => a.kind === "pool" && a.pool && !a.feed);
  const alone = assets.filter((a) => !together.includes(a));

  const batches: Asset[][] = [];
  for (let i = 0; i < together.length; i += BATCH) batches.push(together.slice(i, i + BATCH));
  await Promise.all([
    ...batches.map(async (batch) => {
      const pools = batch.map((a) => a.pool!.toLowerCase()).sort();
      const pairs = await cached(`quotes:${pools.join(",")}`, 4_000, async () => (await getJson<{ pairs: Pair[] | null }>(`${DEXSCREENER}/pairs/${CHAIN}/${pools.join(",")}`)).pairs ?? []).catch(() => [] as Pair[]);
      for (const a of batch) {
        const pair = pairs.find((p) => same(p.pairAddress, a.pool!));
        if (pair && Number(pair.priceUsd) > 0) out[a.key] = poolQuote(pair);
      }
    }),
    ...alone.map(async (a) => {
      const quote = await assetQuote(a).catch(() => null);
      if (quote) out[a.key] = quote;
    }),
  ]);
  return out;
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
  return poolCandles(asset.pool ?? "", asset.address, span, limit, patient);
}

/** A pool's candles, priced in USD, for the one of its two tokens that is named. */
async function poolCandles(pool: string, token: string, span: Interval, limit: number, patient = false): Promise<Candle[]> {
  const { unit, every, seconds, freshMs } = SPAN[span];
  const wanted = Math.min(Math.max(limit, 1), 1000);
  const count = SIZES.find((n) => n >= wanted) ?? 1000;
  const all = await cached(`candles:${pool}:${token.toLowerCase()}:${span}:${count}`, freshMs, async () => {
    const url = `${GECKOTERMINAL}/pools/${pool}/ohlcv/${unit}?aggregate=${every}&limit=${count}&currency=usd&token=${token.toLowerCase()}`;
    const body = await getJson<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(url, patient);
    const rows = (body.data?.attributes?.ohlcv_list ?? []).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }));
    return evenly(rows.sort((a, b) => a.time - b.time), seconds).slice(-count);
  });
  return all.slice(-wanted);
}
