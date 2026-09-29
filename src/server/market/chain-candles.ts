/**
 * Candles made from a pool's own record of its swaps on Robinhood Chain.
 *
 * Every swap in a Uniswap pool is put on-chain with the price it left the pool at. Read from
 * the chain's public endpoint, those records make the same candles a data service would,
 * without depending on one. Pons's pools are Uniswap v4 pools, and those of the first Pons
 * are Uniswap v3 pools; both are read here.
 *
 * Prices on-chain are in the token the pool is quoted in. They are put in USD by setting the
 * latest one to the token's live USD price, so the shape of the chart is the pool's own. What
 * the quote token itself did against the dollar over those hours is not in it.
 */
import { createPublicClient, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { robinhood } from "viem/chains";
import { INTERVAL_SECONDS, type Candle, type Interval } from "@/lib/market";
import { cached } from "./http";

/** Uniswap v4's PoolManager on Robinhood Chain, which every v4 pool lives in. */
const POOL_MANAGER: Hex = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const SWAP_V4 = parseAbiItem("event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)");
const SWAP_V3 = parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)");
const ERC20 = parseAbi(["function decimals() view returns (uint8)"]);

/** The most blocks the chain's public endpoint will search at once. */
const MOST_BLOCKS = 999_999;
/** Blocks between the points at which the time is read. Between them it is worked out. */
const ANCHOR_EVERY = 20_000;
const Q192 = BigInt(2) ** BigInt(192);
const SCALE = BigInt(10) ** BigInt(30);

let client: ReturnType<typeof createPublicClient> | undefined;
const chain = () => (client ??= createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_MAINNET_RPC_URL || undefined, { retryCount: 2, timeout: 15_000 }) }));

const head = () => cached("chain:head", 5_000, () => chain().getBlock().then((b) => ({ number: Number(b.number), time: Number(b.timestamp) })));
/** When a block was made. Blocks at round numbers are read once and remembered. */
const timeOf = (block: number) => cached(`chain:time:${block}`, 86_400_000, () => chain().getBlock({ blockNumber: BigInt(block) }).then((b) => Number(b.timestamp)));
const decimalsOf = (token: string) => cached(`chain:decimals:${token.toLowerCase()}`, 86_400_000, () => chain().readContract({ address: token as Hex, abi: ERC20, functionName: "decimals" }).then(Number));

export interface PoolOnChain {
  /** The pool: a v4 pool's id, or a v3 pool's address. */
  pool: string;
  /** The token the candles are of, and the token the pool prices it in. Native ETH is the zero address. */
  token: string;
  quote: string;
}

/** Whether the pool is one this module can read. */
export const readable = (p: Partial<PoolOnChain>): p is PoolOnChain => !!p.pool && !!p.token && !!p.quote && /^0x[0-9a-fA-F]{40}([0-9a-fA-F]{24})?$/.test(p.pool);

/**
 * The latest `limit` candles of the token, oldest first, with the last one closing at `liveUsd`.
 * Stretches in which nobody traded are flat, at the price before them. Throws if the chain can't be read.
 */
export function chainCandles(p: PoolOnChain, span: Interval, limit: number, liveUsd: number): Promise<Candle[]> {
  const step = INTERVAL_SECONDS[span];
  return cached(`chain:candles:${p.pool.toLowerCase()}:${p.token.toLowerCase()}:${span}:${limit}`, Math.min(step * 500, 45_000), async () => {
    const now = await head();
    // Roughly how fast blocks are made, from the last stretch of them.
    const back = Math.max(now.number - ANCHOR_EVERY * 10, 1);
    const perSecond = (now.number - back) / Math.max(now.time - (await timeOf(back)), 1);
    // A little more than is asked for, so that the first candle has a price to open at.
    const blocks = Math.min(Math.ceil(step * (limit + 6) * perSecond), MOST_BLOCKS);
    const from = Math.max(now.number - blocks, 1);

    const v4 = p.pool.length === 66;
    const range = { fromBlock: BigInt(from), toBlock: BigInt(now.number) };
    const [logs, decimals] = await Promise.all([
      v4 ? chain().getLogs({ address: POOL_MANAGER, event: SWAP_V4, args: { id: p.pool as Hex }, ...range }) : chain().getLogs({ address: p.pool as Hex, event: SWAP_V3, ...range }),
      decimalsOf(p.token).catch(() => 18),
    ]);
    if (logs.length === 0) return [];

    // Times are read at round block numbers and worked out in between.
    const first = Math.floor(from / ANCHOR_EVERY) * ANCHOR_EVERY;
    const at: number[] = [];
    for (let b = Math.max(first, 1); b < now.number; b += ANCHOR_EVERY) at.push(b);
    const times = await Promise.all(at.map(timeOf));
    const anchors = [...at.map((block, i) => ({ block, time: times[i] })), { block: now.number, time: now.time }];
    const when = (block: number) => {
      const i = Math.max(anchors.findIndex((a) => a.block >= block), 1);
      const [a, b] = [anchors[i - 1], anchors[i]];
      return b.block === a.block ? b.time : a.time + ((block - a.block) / (b.block - a.block)) * (b.time - a.time);
    };

    // Uniswap keeps the two tokens of a pool in the order of their addresses.
    const tokenFirst = BigInt(p.token) < BigInt(p.quote);
    const swaps = logs.map((log) => {
      const { sqrtPriceX96, amount0, amount1 } = log.args as { sqrtPriceX96: bigint; amount0: bigint; amount1: bigint };
      // The second token per unit of the first, in the tokens' smallest units.
      const ratio = Number((sqrtPriceX96 * sqrtPriceX96 * SCALE) / Q192) / Number(SCALE);
      const amount = tokenFirst ? amount0 : amount1;
      return { time: when(Number(log.blockNumber)), price: tokenFirst ? ratio : ratio > 0 ? 1 / ratio : 0, tokens: Number(amount < BigInt(0) ? -amount : amount) / 10 ** decimals };
    });
    const priced = swaps.filter((s) => s.price > 0 && isFinite(s.price));
    if (priced.length === 0) return [];
    const toUsd = liveUsd / priced[priced.length - 1].price;

    const candles: Candle[] = [];
    for (const s of priced) {
      const slot = Math.floor(s.time / step) * step;
      const usd = s.price * toUsd;
      const last = candles[candles.length - 1];
      if (last && last.time === slot) {
        last.high = Math.max(last.high, usd);
        last.low = Math.min(last.low, usd);
        last.close = usd;
        last.volume += s.tokens * usd;
        continue;
      }
      const open = last?.close ?? usd;
      // Nobody traded in the stretches between: the price stood where it was.
      if (last) for (let t = last.time + step; t < slot; t += step) candles.push({ time: t, open, high: open, low: open, close: open, volume: 0 });
      candles.push({ time: slot, open, high: Math.max(open, usd), low: Math.min(open, usd), close: usd, volume: s.tokens * usd });
    }
    // And between the last trade and now.
    const present = Math.floor(now.time / step) * step;
    const last = candles[candles.length - 1];
    for (let t = last.time + step; t <= present; t += step) candles.push({ time: t, open: last.close, high: last.close, low: last.close, close: last.close, volume: 0 });
    return candles.slice(-limit);
  });
}
