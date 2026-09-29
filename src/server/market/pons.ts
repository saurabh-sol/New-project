/**
 * Pons, the token launchpad of Robinhood Chain (ponsfamily.com).
 *
 * A token launched on Pons trades on a bonding curve of its own until enough has been paid
 * into it. It then "graduates": the curve's proceeds seed a Uniswap v4 pool whose liquidity
 * is locked for good. The desk trades graduated tokens, which have a pool and so a price.
 *
 * Pons's factory contract puts every launch and every graduation on record. That record is
 * what says a token came from Pons, whatever the token calls itself.
 */
import { createPublicClient, http, parseAbiItem, type Hex } from "viem";
import { robinhood } from "viem/chains";
import { cached } from "./http";

/** PonsV2LaunchFactory on Robinhood Chain. */
export const PONS_FACTORY: Hex = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
/** What GeckoTerminal files Pons's pools under: the launchpad as it is now, and as it was first. */
export const PONS_DEXES = ["pons-v2-dex", "pons-dot-family"];

const LAUNCHED = parseAbiItem("event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)");
const GRADUATED = parseAbiItem("event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)");

/** The chain's public endpoint answers for a million blocks at a time, which is a little over a day. */
const WINDOW = BigInt(999_999);
/** A pool's creation is its token's graduation, give or take. The search starts a little after it and works back. */
const AFTER = BigInt(150_000);
const WINDOWS = 3;

const shared = globalThis as typeof globalThis & { __pons?: Map<string, boolean> };
const known = () => (shared.__pons ??= new Map());

let client: ReturnType<typeof createPublicClient> | undefined;
const chain = () => (client ??= createPublicClient({ chain: robinhood, transport: http(process.env.ROBINHOOD_MAINNET_RPC_URL || undefined, { retryCount: 2, timeout: 12_000 }) }));

/** Where the chain is now, and how fast it makes blocks. */
const pace = () =>
  cached("pons:pace", 600_000, async () => {
    const head = await chain().getBlock();
    const back = await chain().getBlock({ blockNumber: head.number - WINDOW });
    return { head: head.number, at: Number(head.timestamp), perSecond: Number(WINDOW) / Math.max(Number(head.timestamp - back.timestamp), 1) };
  });

/**
 * Whether Pons's factory has a record of this token: its launch, or its graduation.
 * `poolCreatedAt` is when the token's pool was created, in ms, which is where the search begins.
 * Null if the chain can't be read, so that the caller can decide what to make of that.
 */
export async function launchedOnPons(token: string, poolCreatedAt: number): Promise<boolean | null> {
  const key = token.toLowerCase();
  const before = known().get(key);
  if (before !== undefined) return before;
  try {
    const { head, at, perSecond } = await pace();
    const then = head - BigInt(Math.max(0, Math.round((at - poolCreatedAt / 1000) * perSecond)));
    for (let i = 0; i < WINDOWS; i++) {
      const to = then + AFTER - BigInt(i) * (WINDOW + BigInt(1));
      if (to < BigInt(0)) break;
      const range = { address: PONS_FACTORY, args: { token: token as Hex }, fromBlock: to > WINDOW ? to - WINDOW : BigInt(0), toBlock: to > head ? head : to };
      const [graduated, launched] = await Promise.all([chain().getLogs({ ...range, event: GRADUATED }), chain().getLogs({ ...range, event: LAUNCHED })]);
      if (graduated.length || launched.length) {
        known().set(key, true);
        return true;
      }
    }
    known().set(key, false);
    return false;
  } catch (e) {
    console.error("[pons] could not read the factory's record:", e instanceof Error ? e.message.split("\n")[0] : e);
    return null;
  }
}
