/**
 * Keeps the agents' desk contract in step with the desk's books.
 *
 * The database is where the desk's books are kept. After a trade, a deposit or a withdrawal,
 * the same change is made on Robinhood Chain: the agents' cash is funded or released, and
 * each trade is recorded. Every trade then has a transaction that anyone can look up.
 *
 * Nothing here can hold up a session or a payment. If the chain can't be reached, the
 * change waits and is made the next time round.
 */
import { createWalletClient, getAddress, keccak256, parseUnits, toBytes, type Hex } from "viem";
import { AGENT_ORDER } from "@/lib/agents";
import type { DeskAsset } from "@/lib/assets";
import type { DeskInfo } from "@/lib/chains";
import type { Fill, Position, Stakes } from "@/lib/council";
import { ADDRESSES, isToken, type AssetKey } from "@/lib/market";
import deskJson from "../../../contracts/CouncilDesk.json";
import { readState, updateState } from "../council/store";
import { connection } from "./robinhood";
import { queue } from "./shared";

const abi = deskJson.abi;
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** How a sale came about, as the contract records it. */
const REASON = { COUNCIL: 0, STOP: 1, TARGET: 2, OWN: 3 } as const;
/** Differences smaller than this are rounding, and are left alone. */
const ONE_CENT = 0.01;
/** Between trades and payments, the chain is looked at no more often than this. */
const QUIET_MS = 30_000;
/** A trade the chain keeps refusing is left off the chain after this many tries. */
const MAX_TRIES = 4;

const shared = globalThis as typeof globalThis & {
  __desk?: { running: Promise<void> | null; again: boolean; lastLook: number; tries: Map<string, number>; info: { at: number; value: DeskInfo } | null };
};
const memo = () => (shared.__desk ??= { running: null, again: false, lastLook: 0, tries: new Map(), info: null });

const idOf = (fillId: string) => keccak256(toBytes(fillId));
const to18 = (n: number) => parseUnits(n.toFixed(18), 18);

function setup() {
  const c = connection();
  if (!c.desk || !c.account || !c.token) return null;
  const { desk, account, token } = c;
  return { ...c, desk, account, token, wallet: createWalletClient({ account, chain: c.chain, transport: c.transport }) };
}
type Setup = NonNullable<ReturnType<typeof setup>>;

/** Whether trades are recorded on-chain at all. */
export const deskEnabled = () => setup() !== null;

/** The token's contract address, which names it on-chain. Null if the desk no longer knows the token. */
function addressOf(token: AssetKey, assets: Record<AssetKey, DeskAsset>): Hex | null {
  const raw = isToken(token) ? ADDRESSES[token] : assets[token]?.address;
  return raw ? getAddress(raw) : null;
}

async function sendAndWait(s: Setup, functionName: string, args: unknown[]): Promise<Hex> {
  // The treasury's transactions leave one at a time, so none takes another's place in its queue.
  return queue(s.queue, async () => {
    const hash = await s.wallet.writeContract({ address: s.desk, abi, functionName, args });
    const receipt = await s.pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} failed on-chain`);
    return hash;
  });
}

interface OnChain {
  cent: bigint;
  cash: Stakes;
}

async function read(s: Setup): Promise<OnChain> {
  const [cent, balances] = await Promise.all([
    s.pub.readContract({ address: s.desk, abi, functionName: "cent" }) as Promise<bigint>,
    s.pub.readContract({ address: s.desk, abi, functionName: "balances" }) as Promise<[bigint[], bigint[]]>,
  ]);
  const usd = (units: bigint) => Number(units / cent) / 100;
  return { cent, cash: Object.fromEntries(AGENT_ORDER.map((a, i) => [a, usd(balances[0][i])])) as Stakes };
}

/** The contract counts agents 0 to 3, in the desk's usual order. */
const amounts = (stakes: Stakes, cent: bigint) => AGENT_ORDER.map((a) => BigInt(Math.round(stakes[a] * 100)) * cent);

/** Funds or releases an agent's cash on-chain until it holds `target`. */
async function setCash(s: Setup, chain: OnChain, agent: (typeof AGENT_ORDER)[number], target: number) {
  const gap = Math.round((target - chain.cash[agent]) * 100) / 100;
  if (Math.abs(gap) < ONE_CENT) return;
  const units = BigInt(Math.round(Math.abs(gap) * 100)) * chain.cent;
  await sendAndWait(s, gap > 0 ? "fund" : "release", [AGENT_ORDER.indexOf(agent), units]);
  chain.cash[agent] = Math.round((chain.cash[agent] + gap) * 100) / 100;
}

/** The transaction that recorded a trade, looked up by the trade's id. */
async function findRecord(s: Setup, id: Hex, side: Fill["side"]): Promise<Hex | null> {
  const event = abi.find((x) => x.type === "event" && x.name === (side === "BUY" ? "Bought" : "Sold"));
  const fromBlock = BigInt(process.env.DESK_FROM_BLOCK || 0);
  const logs = (await s.pub.getLogs({ address: s.desk, event: event as never, args: { id } as never, fromBlock }).catch(() => [])) as Array<{ transactionHash: Hex }>;
  return logs[0]?.transactionHash ?? null;
}

/** Records one trade. Returns its transaction, or null if the trade can't be put on-chain. */
async function record(s: Setup, chain: OnChain, fill: Fill, assets: Record<AssetKey, DeskAsset>): Promise<Hex | null> {
  const token = addressOf(fill.token, assets);
  if (!token) return null;
  const id = idOf(fill.id);
  if (await s.pub.readContract({ address: s.desk, abi, functionName: "recorded", args: [id] })) return findRecord(s, id, fill.side);

  const buying = fill.side === "BUY";
  // Cash that reached the agent since the chain was last brought up to date: a deposit, most likely.
  if (buying) for (const a of AGENT_ORDER) if (fill.stake[a] > chain.cash[a]) await setCash(s, chain, a, fill.stake[a]);

  const trade = {
    id,
    round: fill.round,
    token,
    symbol: fill.token,
    price: to18(fill.price),
    qty: to18(fill.qty),
    amounts: amounts(fill.stake, chain.cent),
    tag: buying ? AGENT_ORDER.indexOf(fill.leader) : REASON[fill.reason],
  };
  const hash = await sendAndWait(s, buying ? "buy" : "sell", [trade]);
  for (const a of AGENT_ORDER) chain.cash[a] = Math.round((chain.cash[a] + (buying ? -fill.stake[a] : fill.stake[a])) * 100) / 100;
  return hash;
}

/** A position the desk held before the contract existed, written as the purchase that opened it. */
const adopted = (pos: Position): Fill => ({
  id: `adopt-${pos.token}-${pos.openedRound}`,
  round: pos.openedRound,
  ts: pos.openedAt,
  side: "BUY",
  token: pos.token,
  qty: pos.qty,
  price: pos.entryPrice,
  usd: pos.cost,
  reason: "COUNCIL",
  leader: pos.leader,
  realized: null,
  stake: Object.fromEntries(AGENT_ORDER.map((a) => [a, Math.round(pos.stake[a] * 100) / 100])) as Stakes,
});

async function settle(s: Setup): Promise<void> {
  const m = memo();
  // The first time, note when the contract took over. Trades from before then are not on-chain.
  let state = await readState();
  if (state.desk?.address !== s.desk) {
    const since = Date.now();
    state = await updateState((st) => ({ ...st, desk: { address: s.desk, since } }));
    const chain = await read(s);
    for (const pos of state.portfolio.positions) {
      const fill = adopted(pos);
      await record(s, chain, fill, state.assets).catch((e) => console.error(`[desk] could not bring ${pos.token} on-chain:`, e instanceof Error ? e.message : e));
    }
  }
  const since = state.desk!.since;

  const waiting = state.fills.filter((f) => !f.tx && !f.unrecorded && f.ts >= since);
  const chain = await read(s);
  const done: Record<string, string> = {};
  const givenUp = new Set<string>();
  for (const fill of waiting) {
    try {
      const hash = await record(s, chain, fill, state.assets);
      if (hash) done[fill.id] = hash;
      else givenUp.add(fill.id);
    } catch (e) {
      const tries = (m.tries.get(fill.id) ?? 0) + 1;
      m.tries.set(fill.id, tries);
      console.error(`[desk] could not record ${fill.side} ${fill.token}:`, e instanceof Error ? e.message.split("\n")[0] : e);
      if (tries >= MAX_TRIES) givenUp.add(fill.id);
      // Trades are recorded in order. One that fails holds back those after it.
      else break;
    }
  }
  if (Object.keys(done).length || givenUp.size) {
    state = await updateState((st) => ({ ...st, fills: st.fills.map((f) => (done[f.id] ? { ...f, tx: done[f.id] } : givenUp.has(f.id) ? { ...f, unrecorded: true } : f)) }));
  }

  // With every trade on record, what is left to match is money users put in or took out.
  const behind = state.fills.some((f) => !f.tx && !f.unrecorded && f.ts >= since);
  if (!behind) for (const a of AGENT_ORDER) await setCash(s, chain, a, state.portfolio.cash[a]);
  m.info = null;
}

/**
 * Brings the chain up to date with the books. Safe to call often, and from anywhere:
 * calls made while one is running are folded into one more run after it.
 * `now` skips the quiet period, for use straight after a trade or a payment.
 */
export function settleOnChain(now = false): Promise<void> {
  const s = setup();
  if (!s) return Promise.resolve();
  const m = memo();
  if (m.running) {
    m.again = true;
    return m.running;
  }
  if (!now && Date.now() - m.lastLook < QUIET_MS) return Promise.resolve();
  m.lastLook = Date.now();
  m.running = settle(s)
    .catch((e) => console.error("[desk] could not bring the chain up to date:", e instanceof Error ? e.message.split("\n")[0] : e))
    .finally(() => {
      m.running = null;
      if (m.again) {
        m.again = false;
        void settleOnChain(true);
      }
    });
  return m.running;
}

/** The contract as the pages show it. Null if no contract is deployed. */
export async function deskInfo(): Promise<DeskInfo | null> {
  const s = setup();
  if (!s) return null;
  const m = memo();
  if (m.info && Date.now() - m.info.at < QUIET_MS) return m.info.value;
  const state = await readState();
  const since = state.desk?.address === s.desk ? state.desk.since : Date.now();
  const base = { address: s.desk, network: s.name, explorerAddress: `${s.explorer}/address/${s.desk}`, explorerTx: `${s.explorer}/tx/{id}`, since };
  let value: DeskInfo;
  try {
    const [held, decimals, solvent] = await Promise.all([
      s.pub.readContract({ address: s.token, abi: erc20, functionName: "balanceOf", args: [s.desk] }),
      s.pub.readContract({ address: s.token, abi: erc20, functionName: "decimals" }),
      s.pub.readContract({ address: s.desk, abi, functionName: "solvent" }) as Promise<boolean>,
    ]);
    value = { ...base, holds: Number(held / BigInt(10) ** BigInt(decimals - 2)) / 100, solvent };
  } catch {
    value = { ...base, holds: null, solvent: null };
  }
  m.info = { at: Date.now(), value };
  return value;
}
