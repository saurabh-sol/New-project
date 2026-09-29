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
import { assetQuotes, cleanSymbol, longKey } from "./assets";
import { cached, getJson } from "./http";
import { launchedOnPons, PONS_DEXES } from "./pons";
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
  relationships: { base_token: { data: { id: string } }; dex?: { data?: { id?: string } } };
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
    const onPons = (p: Pool) => PONS_DEXES.includes(p.relationships.dex?.data?.id ?? "");
    const list = (path: string, patient = false) => getJson<Trending>(`${GECKOTERMINAL}/${path}${path.includes("?") ? "&" : "?"}include=base_token,dex&page=1`, patient);
    // What is trending on the whole chain comes first. Pons's own busiest pools follow: by trades made, then by money traded.
    const [trending, busiest, largest, older, stocks] = await Promise.all([
      list("trending_pools?duration=1h", true),
      pons ? list(`dexes/${PONS_DEXES[0]}/pools?sort=h24_tx_count_desc`, true).catch(() => null) : null,
      pons ? list(`dexes/${PONS_DEXES[0]}/pools?sort=h24_volume_usd_desc`).catch(() => null) : null,
      pons ? list(`dexes/${PONS_DEXES[1]}/pools?sort=h24_tx_count_desc`).catch(() => null) : null,
      stockTokens().catch(() => new Map<string, { address: string }>()),
    ]);
    const lists = [trending, busiest, older, largest].filter((l): l is Trending => !!l);
    const ranking: Trending = {
      data: lists.flatMap((l, i) => (l.data ?? []).filter((p) => !pons || (i === 0 ? onPons(p) : true))),
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

      const asset: Omit<Asset, "key"> = { symbol, name: token.name, address: token.address, kind: "pool", pool: pool.attributes.address, ...(pons ? { launchpad: "pons" as const } : {}) };
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
