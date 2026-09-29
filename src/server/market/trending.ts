/**
 * The tokens the agents choose from: those launched on Pons that are trending right now.
 *
 * Pons is the launchpad of Robinhood Chain. GeckoTerminal ranks the chain's trading pools by
 * how much attention they are getting, and lists Pons's pools by how much they trade. The
 * desk takes the Pons tokens at the top of those lists, keeps to pools with enough money,
 * trading and history to be read, and checks each token against the record of Pons's own
 * factory. The list is made again for every session, so it follows the market.
 */
import type { Asset, AssetQuote, DeskAsset } from "@/lib/assets";
import { isToken } from "@/lib/market";
import { assetQuotes, cleanSymbol, listings, longKey, type Listing } from "./assets";
import { cached, getJson } from "./http";
import { graduates, launchedOnPons, PONS_DEXES } from "./pons";
import { stockTokens } from "./stocks";

const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2/networks/robinhood";

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

/**
 * Where the board's tokens come from. "pons": tokens launched on Pons, and no others.
 * "any": whatever is trending on the chain. Set with BOARD_LAUNCHPAD.
 */
export const boardSource = (): "pons" | "any" => (process.env.BOARD_LAUNCHPAD === "any" ? "any" : "pons");

/** What a trending pool must show before its token goes on the board. */
export const boardLimits = () => ({
  size: Math.max(1, Math.round(num(process.env.BOARD_SIZE, 8))),
  minLiquidityUsd: num(process.env.BOARD_MIN_LIQUIDITY_USD, 30_000),
  minVolumeUsd: num(process.env.BOARD_MIN_VOLUME_USD, 100_000),
  // The agents read three hours of candles. A pool younger than this has too few.
  minAgeHours: num(process.env.BOARD_MIN_AGE_HOURS, 6),
});

/** How far back the factory's record is read for tokens that graduated, in days. */
const GRADUATED_WITHIN_DAYS = 30;
/** How often every graduate is looked at again. In between, only the busiest are. */
const SURVEY_MS = 30 * 60_000;
const WATCHED = 60;

/**
 * Pons's graduates and how they are trading, busiest over the last hour first.
 * The factory's record says which tokens they are, and DexScreener how each is trading.
 */
async function ponsListings(): Promise<Listing[]> {
  const busiest = (all: Listing[]) => [...all].sort((a, b) => b.volume1hUsd - a.volume1hUsd || b.quote.volume24hUsd - a.quote.volume24hUsd);
  const survey = await cached("pons:survey", SURVEY_MS, async () => {
    const tokens = (await graduates(GRADUATED_WITHIN_DAYS)).map((g) => g.token);
    const all = await listings(tokens);
    if (tokens.length > 0 && all.length === 0) throw new Error("Pons's tokens could not be priced");
    // Those worth a second look, by what they traded in a day.
    return [...all].sort((a, b) => b.quote.volume24hUsd - a.quote.volume24hUsd).slice(0, WATCHED);
  });
  // The busiest are asked about again every time, so the order is this minute's.
  const fresh = await cached("pons:watched", 45_000, () => listings(survey.map((l) => l.token))).catch(() => [] as Listing[]);
  return busiest(fresh.length ? fresh : survey);
}

/** Not trending tokens in the desk's sense: money, and wrapped ETH, which everything else is priced in. */
const MONEY = new Set(["USDG", "USDC", "USDT", "DAI", "USDE", "PYUSD", "WETH", "ETH"]);
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

interface Pool {
  attributes: {
    address: string;
    name: string;
    base_token_price_usd?: string | null;
    reserve_in_usd?: string | null;
    pool_created_at?: string | null;
    volume_usd?: { h24?: string };
    price_change_percentage?: { m5?: string; h1?: string; h24?: string };
    transactions?: { m5?: { buys?: number; sells?: number } };
  };
  relationships: { base_token: { data: { id: string } }; quote_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
}
interface Trending {
  data?: Pool[];
  included?: Array<{ id: string; attributes: { address: string; name: string; symbol: string } }>;
}

const quoteOf = (p: Pool): AssetQuote => ({
  price: Number(p.attributes.base_token_price_usd ?? 0),
  change24h: Number(p.attributes.price_change_percentage?.h24 ?? 0),
  liquidityUsd: Number(p.attributes.reserve_in_usd ?? 0),
  volume24hUsd: Number(p.attributes.volume_usd?.h24 ?? 0),
  change5m: Number(p.attributes.price_change_percentage?.m5 ?? 0),
  change1h: Number(p.attributes.price_change_percentage?.h1 ?? 0),
  buys5m: p.attributes.transactions?.m5?.buys,
  sells5m: p.attributes.transactions?.m5?.sells,
});

/**
 * The board: trending tokens that clear the desk's limits, most talked about first, each with
 * a live quote. `known` are tokens the desk already has names for, whose names are kept.
 * Throws if the ranking can't be read.
 */
export function trendingBoard(known: Record<string, DeskAsset> = {}): Promise<DeskAsset[]> {
  const source = boardSource();
  return cached(`board:trending:${source}`, 60_000, async () => {
    const limits = boardLimits();
    const pons = source === "pons";
    if (pons) {
      // The first choice needs nothing but the chain and DexScreener.
      const fromChain = await boardFromChain(limits, known).catch((e) => (console.error("[board] could not make the board from Pons's record:", e instanceof Error ? e.message.split("\n")[0] : e), []));
      if (fromChain.length >= Math.min(3, limits.size)) return fromChain;
    }
    const onPons = (p: Pool) => PONS_DEXES.includes(p.relationships.dex?.data?.id ?? "");
    // The data service allows few requests a minute, and the agents' candles need most of them. Pons's own lists change slowly, and are kept for five minutes.
    const list = (path: string, patient = false) =>
      cached(`board:list:${path}`, path.startsWith("dexes/") ? 300_000 : 55_000, () => getJson<Trending>(`${GECKOTERMINAL}/${path}${path.includes("?") ? "&" : "?"}include=base_token,dex&page=1`, patient));
    // What is trending on the whole chain comes first. Pons's own busiest pools follow: by trades made, then by money traded.
    const [trending, busiest, largest, older, stocks] = await Promise.all([
      // With Pons's own lists to go by, the board can be made without the chain's ranking.
      pons ? list("trending_pools?duration=1h", true).catch(() => null) : list("trending_pools?duration=1h", true),
      pons ? list(`dexes/${PONS_DEXES[0]}/pools?sort=h24_tx_count_desc`, true).catch(() => null) : null,
      pons ? list(`dexes/${PONS_DEXES[0]}/pools?sort=h24_volume_usd_desc`).catch(() => null) : null,
      pons ? list(`dexes/${PONS_DEXES[1]}/pools?sort=h24_tx_count_desc`).catch(() => null) : null,
      stockTokens().catch(() => new Map<string, { address: string }>()),
    ]);
    const lists = [trending, busiest, older, largest].filter((l): l is Trending => !!l);
    if (lists.length === 0) throw new Error("The lists of trending pools can't be reached");
    const ranking: Trending = {
      data: lists.flatMap((l) => (l.data ?? []).filter((p) => !pons || onPons(p))),
      included: lists.flatMap((l) => l.included ?? []),
    };
    const tokens = new Map((ranking.included ?? []).map((t) => [t.id, t.attributes]));
    const stockAddresses = new Set([...stocks.values()].map((s) => s.address.toLowerCase()));
    const byAddress = new Map(Object.values(known).map((a) => [a.address.toLowerCase(), a]));

    const board: DeskAsset[] = [];
    const taken = new Set<string>();
    for (const pool of ranking.data ?? []) {
      if (board.length >= limits.size) break;
      const token = tokens.get(pool.relationships.base_token.data.id);
      if (!token) continue;
      const address = token.address.toLowerCase();
      const symbol = token.symbol.replace(/^\$/, "");
      if (board.some((b) => b.address.toLowerCase() === address)) continue;
      // The desk does not trade ETH or Stock Tokens by itself, and money is what it trades with.
      if (address === WETH || address === USDG || MONEY.has(symbol.toUpperCase()) || stockAddresses.has(address)) continue;

      const quote = quoteOf(pool);
      const created = Date.parse(pool.attributes.pool_created_at ?? "");
      const ageHours = isFinite(created) ? (Date.now() - created) / 3_600_000 : Infinity;
      if (!(quote.price > 0) || (quote.liquidityUsd ?? 0) < limits.minLiquidityUsd || quote.volume24hUsd < limits.minVolumeUsd || ageHours < limits.minAgeHours) continue;

      // The data service files the pool under Pons. The factory's own record settles it, where the chain can be read.
      if (pons && (await launchedOnPons(token.address, isFinite(created) ? created : Date.now())) === false && pool.relationships.dex?.data?.id !== PONS_DEXES[1]) continue;

      const quoteToken = pool.relationships.quote_token?.data?.id?.split("_")[1];
      const asset: Omit<Asset, "key"> = { symbol, name: token.name, address: token.address, kind: "pool", pool: pool.attributes.address, ...(quoteToken ? { quoteToken } : {}), ...(pons ? { launchpad: "pons" as const } : {}) };
      const before = byAddress.get(address);
      // A token that borrows the symbol of a Stock Token, or of another token on the board, gets a longer name.
      const plain = cleanSymbol(symbol);
      const clash = isToken(plain) || stocks.has(plain) || taken.has(plain) || (known[plain] && known[plain].address.toLowerCase() !== address);
      const key = before?.key ?? (clash ? longKey(asset) : plain);
      taken.add(key);
      board.push({ ...asset, key, quote, quotedAt: Date.now() });
    }

    // DexScreener's prices are a few seconds old, GeckoTerminal's up to a minute. Where both have the pool, the newer wins.
    const live = await assetQuotes(board).catch(() => ({}) as Record<string, AssetQuote>);
    return board.map((a) => (live[a.key] ? { ...a, quote: live[a.key], quotedAt: Date.now() } : { ...a, feed: "gecko" as const }));
  });
}

/** The board made from the factory's record: graduates of Pons that clear the desk's limits, busiest first. */
async function boardFromChain(limits: ReturnType<typeof boardLimits>, known: Record<string, DeskAsset>): Promise<DeskAsset[]> {
  const [all, stocks] = await Promise.all([ponsListings(), stockTokens().catch(() => new Map<string, { address: string }>())]);
  const byAddress = new Map(Object.values(known).map((a) => [a.address.toLowerCase(), a]));
  const board: DeskAsset[] = [];
  const taken = new Set<string>();
  for (const l of all) {
    if (board.length >= limits.size) break;
    const symbol = l.symbol.replace(/^\$/, "");
    if (MONEY.has(symbol.toUpperCase())) continue;
    const ageHours = l.createdAt ? (Date.now() - l.createdAt) / 3_600_000 : Infinity;
    if ((l.quote.liquidityUsd ?? 0) < limits.minLiquidityUsd || l.quote.volume24hUsd < limits.minVolumeUsd || ageHours < limits.minAgeHours) continue;

    const asset: Omit<Asset, "key"> = { symbol, name: l.name, address: l.token, kind: "pool", pool: l.pool, ...(l.quoteToken ? { quoteToken: l.quoteToken } : {}), launchpad: "pons" };
    const plain = cleanSymbol(symbol);
    const clash = isToken(plain) || stocks.has(plain) || taken.has(plain) || (known[plain] && known[plain].address.toLowerCase() !== l.token);
    const key = byAddress.get(l.token)?.key ?? (clash ? longKey(asset) : plain);
    if (taken.has(key)) continue;
    taken.add(key);
    board.push({ ...asset, key, quote: l.quote, quotedAt: Date.now() });
  }
  return board;
}
