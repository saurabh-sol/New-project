/**
 * The agents' wallets: where the desk trades on the market.
 *
 * Each agent has a wallet contract of its own on Robinhood Chain (contracts/AgentWallet.sol).
 * It holds the agent's USDG and the tokens the agent buys. A purchase is a swap of USDG for the
 * token in the token's Uniswap v4 pool, and a sale is the swap back. What an agent gains or
 * loses, it gains from or loses to the market.
 *
 * The desk trades tokens whose pool is one of Pons's and is paired with USDG. Before every swap
 * it asks the chain what the swap would bring, and refuses one that costs too much or whose
 * price has moved. The wallet itself refuses a purchase over its cap.
 */
import { createWalletClient, encodeAbiParameters, formatUnits, getAddress, isAddress, keccak256, parseAbi, parseEventLogs, parseUnits, type Hex } from "viem";
import { AGENT_ORDER } from "@/lib/agents";
import type { DeskAsset } from "@/lib/assets";
import type { AgentDeskInfo, DeskInfo } from "@/lib/chains";
import type { Stakes } from "@/lib/council";
import type { AgentId } from "@/lib/types";
import walletJson from "../../../contracts/AgentWallet.json";
import { connection } from "./robinhood";
import { queue } from "./shared";

const abi = walletJson.abi;
const erc20 = parseAbi(["function balanceOf(address owner) view returns (uint256)", "function decimals() view returns (uint8)"]);
const manager = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

/** Uniswap v4's pool manager on Robinhood Chain, which holds every pool. */
const POOL_MANAGER: Hex = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
/** The hook every pool of Pons's uses. It takes Pons's fee after each swap. */
const PONS_HOOK: Hex = getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044");
/** Pons's pools name no fee of their own, and all use this spacing. */
const POOL_FEE = 0;
const TICK_SPACING = 200;
/** Where the pool manager keeps its pools. */
const POOLS_SLOT = BigInt(6);

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};
/** The most a swap may cost against the pool's price, in percent, fee and price movement together. One way: a round trip costs twice this. */
export const maxCostPct = () => num(process.env.REAL_MAX_COST_PCT, 1.5);
/** How far the price may move between the desk asking what a swap brings and the swap, in percent. */
const slippagePct = () => num(process.env.REAL_SLIPPAGE_PCT, 3);

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const asAddress = (raw: string | undefined): Hex | null => (raw && isAddress(raw, { strict: false }) ? getAddress(raw) : null);

interface PoolKey {
  currency0: Hex;
  currency1: Hex;
  fee: number;
  tickSpacing: number;
  hooks: Hex;
}
const idOf = (k: PoolKey) =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

function setup() {
  const c = connection();
  const found = AGENT_ORDER.map((a) => [a, asAddress(process.env[`WALLET_${a.toUpperCase()}`])] as const);
  if (!found.every(([, w]) => w) || !c.account || !c.token) return null;
  const { account, token } = c;
  return { ...c, account, token, wallets: Object.fromEntries(found) as Record<AgentId, Hex>, signer: createWalletClient({ account, chain: c.chain, transport: c.transport }) };
}
type Setup = NonNullable<ReturnType<typeof setup>>;

/** Whether the desk trades on the market: every agent's wallet is set, and the key that operates them. */
export const realTrading = () => setup() !== null;

const shared = globalThis as typeof globalThis & { __walletDecimals?: Map<string, Promise<number>>; __walletInfo?: { at: number; value: DeskInfo } };
function decimalsOf(s: Setup, token: Hex): Promise<number> {
  const known = (shared.__walletDecimals ??= new Map());
  let value = known.get(token);
  if (!value) {
    value = s.pub.readContract({ address: token, abi: erc20, functionName: "decimals" }).then(Number);
    known.set(token, value);
    value.catch(() => known.delete(token));
  }
  return value;
}

/** The pool a token is swapped in, or why the desk can't swap it. */
function poolOf(s: Setup, asset: DeskAsset | undefined): { key: PoolKey; moneyFirst: boolean; token: Hex } | { why: string } {
  if (!asset || asset.kind !== "pool" || !asset.pool || asset.pool.length !== 66) return { why: "it does not trade in a pool the desk can swap in" };
  if (!asset.quoteToken || !same(asset.quoteToken, s.token)) return { why: "its pool is not paired with USDG" };
  const token = getAddress(asset.address);
  const moneyFirst = BigInt(s.token) < BigInt(token);
  const key: PoolKey = { currency0: moneyFirst ? s.token : token, currency1: moneyFirst ? token : s.token, fee: POOL_FEE, tickSpacing: TICK_SPACING, hooks: PONS_HOOK };
  // The pool the prices come from must be the very pool the swap goes to.
  if (!same(idOf(key), asset.pool)) return { why: "its pool is not set up as Pons's pools are" };
  return { key, moneyFirst, token };
}

/** Why the desk can't trade this token on the market, or null if it can. Null too when the desk does not trade on the market. */
export function notTradable(asset: DeskAsset | undefined): string | null {
  const s = setup();
  if (!s) return null;
  const pool = poolOf(s, asset);
  return "why" in pool ? pool.why : null;
}

/** What a swap would bring right now. Nothing is sent. */
async function ask(s: Setup, wallet: Hex, key: PoolKey, zeroForOne: boolean, amountIn: bigint): Promise<{ paid: bigint; got: bigint }> {
  const { result } = await s.pub.simulateContract({ account: s.account, address: wallet, abi, functionName: "swap", args: [key, zeroForOne, amountIn, BigInt(0)] });
  const [paid, got] = result as unknown as [bigint, bigint];
  return { paid, got };
}

/** What `amountIn` would bring at the pool's price as it stands, with no fee and without moving it. */
async function atPoolPrice(s: Setup, key: PoolKey, zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
  const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [idOf(key), POOLS_SLOT]));
  const word = BigInt(await s.pub.readContract({ address: POOL_MANAGER, abi: manager, functionName: "extsload", args: [slot] }));
  const sqrt = word & ((BigInt(1) << BigInt(160)) - BigInt(1));
  if (sqrt === BigInt(0)) return BigInt(0);
  return zeroForOne ? (amountIn * sqrt * sqrt) >> BigInt(192) : (amountIn << BigInt(192)) / (sqrt * sqrt);
}

/** Sends a swap from an agent's wallet and waits for it. The operator's transactions leave one at a time. */
async function send(s: Setup, wallet: Hex, key: PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint) {
  return queue(s.queue, async () => {
    const hash = await s.signer.writeContract({ address: wallet, abi, functionName: "swap", args: [key, zeroForOne, amountIn, minOut] });
    const receipt = await s.pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("the swap failed on-chain");
    const done = parseEventLogs({ abi, eventName: "Swapped", logs: receipt.logs }) as unknown as Array<{ args: { paid: bigint; got: bigint } }>;
    if (!done[0]) throw new Error("the swap left no record");
    return { hash, paid: done[0].args.paid, got: done[0].args.got };
  });
}

const least = (got: bigint) => (got * BigInt(Math.round((100 - slippagePct()) * 100))) / BigInt(10_000);

/** A swap as it was made. */
export interface RealFill {
  /** USDG paid (a purchase) or received (a sale). */
  usd: number;
  /** Tokens received (a purchase) or sold (a sale). */
  units: number;
  tx: string;
}

/** A purchase the desk will not make, with the reason in words an agent can say. */
export class NoTrade extends Error {}

function need(): Setup {
  const s = setup();
  if (!s) throw new Error("The agents' wallets are not set");
  return s;
}

/** Buys `usd` of a token for an agent, on the market. Throws `NoTrade` if the desk will not make the purchase. */
export async function realBuy(agent: AgentId, asset: DeskAsset | undefined, usd: number): Promise<RealFill> {
  const s = need();
  const pool = poolOf(s, asset);
  if ("why" in pool) throw new NoTrade(`${asset?.symbol ?? "That token"} can't be bought: ${pool.why}`);
  const [moneyDecimals, tokenDecimals] = await Promise.all([decimalsOf(s, s.token), decimalsOf(s, pool.token)]);
  const amountIn = parseUnits(usd.toFixed(2), moneyDecimals);
  const [would, fair] = await Promise.all([ask(s, s.wallets[agent], pool.key, pool.moneyFirst, amountIn), atPoolPrice(s, pool.key, pool.moneyFirst, amountIn)]);
  const costPct = fair > BigInt(0) ? (1 - Number(would.got) / Number(fair)) * 100 : 100;
  if (costPct > maxCostPct()) throw new NoTrade(`Buying ${asset!.symbol} costs ${costPct.toFixed(1)}% on the way in, and the desk pays ${maxCostPct()}% at most`);
  const done = await send(s, s.wallets[agent], pool.key, pool.moneyFirst, amountIn, least(would.got));
  return { usd: Number(formatUnits(done.paid, moneyDecimals)), units: Number(formatUnits(done.got, tokenDecimals)), tx: done.hash };
}

/** Sells a share of what an agent's wallet holds of a token, on the market. Null if it holds none. */
export async function realSell(agent: AgentId, asset: DeskAsset | undefined, fraction: number): Promise<RealFill | null> {
  const s = need();
  const pool = poolOf(s, asset);
  if ("why" in pool) throw new NoTrade(`${asset?.symbol ?? "That token"} can't be sold: ${pool.why}`);
  const [moneyDecimals, tokenDecimals, held] = await Promise.all([decimalsOf(s, s.token), decimalsOf(s, pool.token), s.pub.readContract({ address: pool.token, abi: erc20, functionName: "balanceOf", args: [s.wallets[agent]] })]);
  const amountIn = fraction >= 0.999999 ? held : (held * BigInt(Math.round(Math.max(fraction, 0) * 1_000_000))) / BigInt(1_000_000);
  if (amountIn === BigInt(0)) return null;
  const would = await ask(s, s.wallets[agent], pool.key, !pool.moneyFirst, amountIn);
  const done = await send(s, s.wallets[agent], pool.key, !pool.moneyFirst, amountIn, least(would.got));
  return { usd: Number(formatUnits(done.got, moneyDecimals)), units: Number(formatUnits(done.paid, tokenDecimals)), tx: done.hash };
}

/** What an agent would get, in USDG, if it sold all it holds of a token now. Null if the chain can't say. */
export async function sellValue(agent: AgentId, asset: DeskAsset | undefined): Promise<number | null> {
  const s = need();
  const pool = poolOf(s, asset);
  if ("why" in pool) return null;
  try {
    const held = await s.pub.readContract({ address: pool.token, abi: erc20, functionName: "balanceOf", args: [s.wallets[agent]] });
    if (held === BigInt(0)) return 0;
    const [would, moneyDecimals] = await Promise.all([ask(s, s.wallets[agent], pool.key, !pool.moneyFirst, held), decimalsOf(s, s.token)]);
    return Number(formatUnits(would.got, moneyDecimals));
  } catch {
    return null;
  }
}

/** The USDG each agent's wallet holds, to the cent. */
export async function walletCash(): Promise<Stakes> {
  const s = need();
  const decimals = await decimalsOf(s, s.token);
  const held = await Promise.all(AGENT_ORDER.map((a) => s.pub.readContract({ address: s.token, abi: erc20, functionName: "balanceOf", args: [s.wallets[a]] })));
  return Object.fromEntries(AGENT_ORDER.map((a, i) => [a, Number(held[i] / BigInt(10) ** BigInt(decimals - 2)) / 100])) as Stakes;
}

/** The wallets as the pages show them. Null if the desk does not trade on the market. */
export async function walletsInfo(since: number): Promise<DeskInfo | null> {
  const s = setup();
  if (!s) return null;
  const kept = shared.__walletInfo;
  if (kept && Date.now() - kept.at < 30_000) return { ...kept.value, since };
  const cash = await walletCash().catch(() => null);
  const agents = Object.fromEntries(
    AGENT_ORDER.map((a): [AgentId, AgentDeskInfo] => [a, { address: s.wallets[a], explorerAddress: `${s.explorer}/address/${s.wallets[a]}`, holds: cash ? cash[a] : null, solvent: cash ? true : null }]),
  ) as DeskInfo["agents"];
  const value: DeskInfo = {
    network: s.name,
    explorerTx: `${s.explorer}/tx/{id}`,
    agents,
    holds: cash ? Math.round(AGENT_ORDER.reduce((t, a) => t + cash[a], 0) * 100) / 100 : null,
    solvent: cash ? true : null,
    since,
    market: true,
  };
  shared.__walletInfo = { at: Date.now(), value };
  return value;
}
