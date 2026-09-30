/**
 * Keeps the agents' desk contracts in step with the desk's books.
 *
 * Each agent has a contract of its own on Robinhood Chain. The database is where the desk's
 * books are kept. After a trade, a deposit or a withdrawal, the same change is made on-chain:
 * the agent's cash is funded or released, and its part of each trade is recorded on its own
 * contract. So what an agent did can be looked up at one address, by anyone.
 *
 * Nothing here can hold up a session or a payment. If the chain can't be reached, the
 * change waits and is made the next time round.
 */
import { createWalletClient, getAddress, keccak256, parseUnits, toBytes, type Hex } from "viem";
import { AGENT_ORDER } from "@/lib/agents";
import type { DeskAsset } from "@/lib/assets";
import type { AgentDeskInfo, DeskInfo } from "@/lib/chains";
import { unitsOf, type Fill, type FillReason, type Position, type Stakes } from "@/lib/council";
import { ADDRESSES, isToken, type AssetKey } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import deskJson from "../../../contracts/AgentDesk.json";
import { readState, updateState } from "../council/store";
import { connection } from "./robinhood";
import { queue } from "./shared";

const abi = deskJson.abi;
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** Why a trade was made, as the contracts record it. */
const REASON: Record<FillReason, number> = { COUNCIL: 0, STOP: 1, TARGET: 2, OWN: 3, FALLING: 4 };
/** Differences smaller than this are rounding, and are left alone. */
const ONE_CENT = 0.01;
/** Between trades and payments, the chain is looked at no more often than this. */
const QUIET_MS = 30_000;
/** A trade the chain keeps refusing is left off the chain after this many tries. */
const MAX_TRIES = 4;
/** A sale of this much of a position, or more, sells all of it. */
const ALL = 1 - 1e-9;
const PARTS = BigInt(1_000_000_000_000);

const shared = globalThis as typeof globalThis & {
  __desk?: { running: Promise<void> | null; again: boolean; lastLook: number; tries: Map<string, number>; info: { at: number; value: DeskInfo } | null };
};
const memo = () => (shared.__desk ??= { running: null, again: false, lastLook: 0, tries: new Map(), info: null });

/** An agent's part of a trade has a name of its own, so each contract records it once. */
const idOf = (fillId: string, agent: AgentId) => keccak256(toBytes(`${fillId}:${agent}`));
const to18 = (n: number) => parseUnits(n.toFixed(18), 18);
const round2 = (n: number) => Math.round(n * 100) / 100;

function setup() {
  const c = connection();
  if (!c.desks || !c.account || !c.token) return null;
  const { desks, account, token } = c;
  return { ...c, desks, account, token, wallet: createWalletClient({ account, chain: c.chain, transport: c.transport }) };
}
type Setup = NonNullable<ReturnType<typeof setup>>;

/** Names this set of contracts. The books note which set they were last brought in step with. */
const setOf = (s: Setup) => AGENT_ORDER.map((a) => s.desks[a].toLowerCase()).join(",");

/** Whether trades are recorded on-chain at all. */
export const deskEnabled = () => setup() !== null;

/** The token's contract address, which names it on-chain. Null if the desk no longer knows the token. */
function addressOf(token: AssetKey, assets: Record<AssetKey, DeskAsset>): Hex | null {
  const raw = isToken(token) ? ADDRESSES[token] : assets[token]?.address;
  return raw ? getAddress(raw) : null;
}

async function sendAndWait(s: Setup, agent: AgentId, functionName: string, args: unknown[]): Promise<Hex> {
  // The treasury's transactions leave one at a time, so none takes another's place in its queue.
  return queue(s.queue, async () => {
    const hash = await s.wallet.writeContract({ address: s.desks[agent], abi, functionName, args });
    const receipt = await s.pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error(`${functionName} failed on ${agent}'s desk`);
    return hash;
  });
}

interface OnChain {
  cent: bigint;
  cash: Stakes;
}

async function read(s: Setup): Promise<OnChain> {
  const [cent, ...cash] = await Promise.all([
    s.pub.readContract({ address: s.desks.quant, abi, functionName: "cent" }) as Promise<bigint>,
    ...AGENT_ORDER.map((a) => s.pub.readContract({ address: s.desks[a], abi, functionName: "cash" }) as Promise<bigint>),
  ]);
  const usd = (units: bigint) => Number(units / cent) / 100;
  return { cent, cash: Object.fromEntries(AGENT_ORDER.map((a, i) => [a, usd(cash[i])])) as Stakes };
}

const cents = (usd: number, cent: bigint) => BigInt(Math.round(usd * 100)) * cent;

/** USDG the treasury holds. The agents' capital comes from it, and the gains of their trades. */
async function treasuryHolds(s: Setup, cent: bigint): Promise<number> {
  const units = await s.pub.readContract({ address: s.token, abi: erc20, functionName: "balanceOf", args: [s.account.address] });
  return Number(units / cent) / 100;
}

/** Funds or releases an agent's cash on its contract until it holds `target`. */
async function setCash(s: Setup, chain: OnChain, agent: AgentId, target: number) {
  const gap = round2(target - chain.cash[agent]);
  if (Math.abs(gap) < ONE_CENT) return;
  await sendAndWait(s, agent, gap > 0 ? "fund" : "release", [cents(Math.abs(gap), chain.cent)]);
  chain.cash[agent] = round2(chain.cash[agent] + gap);
}

/** The transaction that recorded an agent's part of a trade, looked up by its id. */
async function findRecord(s: Setup, agent: AgentId, id: Hex, side: Fill["side"]): Promise<Hex | null> {
  const event = abi.find((x) => x.type === "event" && x.name === (side === "BUY" ? "Bought" : "Sold"));
  const fromBlock = BigInt(process.env.DESK_FROM_BLOCK || 0);
  const logs = (await s.pub.getLogs({ address: s.desks[agent], event: event as never, args: { id } as never, fromBlock }).catch(() => [])) as Array<{ transactionHash: Hex }>;
  return logs[0]?.transactionHash ?? null;
}

/** Agents with a part in the trade. */
const partiesTo = (fill: Fill) => AGENT_ORDER.filter((a) => fill.stake[a] >= ONE_CENT);

/** Tokens the agent bought in this purchase. */
const bought = (fill: Fill, agent: AgentId) => fill.units?.[agent] ?? (fill.usd > 0 ? (fill.stake[agent] / fill.usd) * fill.qty : 0);

/**
 * Records one agent's part of a trade on its contract.
 * Returns the transaction, or null if there is nothing of it to put on-chain.
 */
async function recordPart(s: Setup, chain: OnChain, fill: Fill, agent: AgentId, token: Hex): Promise<Hex | null> {
  const desk = s.desks[agent];
  const id = idOf(fill.id, agent);
  if (await s.pub.readContract({ address: desk, abi, functionName: "recorded", args: [id] })) return findRecord(s, agent, id, fill.side);

  const usd = fill.stake[agent];
  const trade = { id, round: fill.round, token, symbol: fill.token, reason: REASON[fill.reason], usd: cents(usd, chain.cent) };

  if (fill.side === "BUY") {
    const qty = bought(fill, agent);
    if (!(qty > 0)) return null;
    // Cash that reached the agent since the chain was last brought up to date: a deposit, most likely.
    if (usd > chain.cash[agent]) await setCash(s, chain, agent, usd);
    // A purchase is the council's or the agent's own. Any other reason belongs to a sale.
    const reason = fill.reason === "OWN" ? REASON.OWN : REASON.COUNCIL;
    const hash = await sendAndWait(s, agent, "buy", [{ ...trade, reason, price: to18(usd / qty), qty: to18(qty) }]);
    chain.cash[agent] = round2(chain.cash[agent] - usd);
    return hash;
  }

  // The contract knows how much the agent holds. The books say what share of it was sold.
  const [held] = (await s.pub.readContract({ address: desk, abi, functionName: "position", args: [token] })) as [bigint, bigint, number];
  if (held === BigInt(0)) return null;
  const fraction = fill.fraction ?? 1;
  const qty = fraction >= ALL ? held : (held * BigInt(Math.round(fraction * Number(PARTS)))) / PARTS;
  if (qty === BigInt(0)) return null;
  const hash = await sendAndWait(s, agent, "sell", [{ ...trade, price: to18(fill.price), qty }]);
  chain.cash[agent] = round2(chain.cash[agent] + usd);
  return hash;
}

type Recorded = Partial<Record<AgentId, string>>;

/**
 * Records a trade, one agent at a time. `done` takes the transactions as they are made, so
 * that a trade which breaks off half way is taken up where it stopped.
 * Returns false if none of it can be put on-chain.
 */
async function record(s: Setup, chain: OnChain, fill: Fill, assets: Record<AssetKey, DeskAsset>, done: Recorded): Promise<boolean> {
  const token = addressOf(fill.token, assets);
  if (!token) return false;
  for (const agent of partiesTo(fill)) {
    if (done[agent]) continue;
    const hash = await recordPart(s, chain, fill, agent, token);
    if (hash) done[agent] = hash;
  }
  return Object.keys(done).length > 0;
}

/** A position the desk held before the contracts existed, written as the purchase that opened it. */
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
  stake: Object.fromEntries(AGENT_ORDER.map((a) => [a, round2(pos.stake[a])])) as Stakes,
  units: Object.fromEntries(AGENT_ORDER.map((a) => [a, unitsOf(pos, a)])) as Stakes,
});

const firstOf = (txs: Recorded) => AGENT_ORDER.map((a) => txs[a]).find(Boolean);

async function settle(s: Setup): Promise<void> {
  const m = memo();
  // The first time, note when the contracts took over. Trades from before then are not on them.
  let state = await readState();
  if (state.desk?.address !== setOf(s)) {
    const since = Date.now();
    state = await updateState((st) => ({ ...st, desk: { address: setOf(s), since } }));
    const chain = await read(s);
    for (const pos of state.portfolio.positions) {
      await record(s, chain, adopted(pos), state.assets, {}).catch((e) => console.error(`[desk] could not bring ${pos.token} on-chain:`, e instanceof Error ? e.message.split("\n")[0] : e));
    }
  }
  const since = state.desk!.since;

  const waiting = state.fills.filter((f) => !f.tx && !f.unrecorded && f.ts >= since);
  const chain = await read(s);
  const done: Record<string, Recorded> = {};
  const finished = new Set<string>();
  const givenUp = new Set<string>();
  for (const fill of waiting) {
    const txs: Recorded = { ...fill.txs };
    try {
      const some = await record(s, chain, fill, state.assets, txs);
      done[fill.id] = txs;
      if (some) finished.add(fill.id);
      else givenUp.add(fill.id);
    } catch (e) {
      done[fill.id] = txs;
      // A trade the treasury has no USDG for is not given up on. It waits for the money.
      const unfunded = (await treasuryHolds(s, chain.cent).catch(() => Infinity)) < fill.usd;
      const tries = unfunded ? 0 : (m.tries.get(fill.id) ?? 0) + 1;
      m.tries.set(fill.id, tries);
      console.error(`[desk] could not record ${fill.side} ${fill.token}${unfunded ? ", which waits for USDG in the treasury" : ""}:`, e instanceof Error ? e.message.split("\n")[0] : e);
      if (tries >= MAX_TRIES) givenUp.add(fill.id);
      // Trades are recorded in order. One that fails holds back those after it.
      else break;
    }
  }
  if (Object.keys(done).length) {
    state = await updateState((st) => ({
      ...st,
      fills: st.fills.map((f) => {
        const txs = done[f.id];
        if (!txs) return f;
        const kept = Object.keys(txs).length ? { ...f, txs } : f;
        if (finished.has(f.id)) return { ...kept, tx: firstOf(txs) };
        return givenUp.has(f.id) ? { ...kept, unrecorded: true } : kept;
      }),
    }));
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

/** The contracts as the pages show them. Null if they are not deployed. */
export async function deskInfo(): Promise<DeskInfo | null> {
  const s = setup();
  if (!s) return null;
  const m = memo();
  if (m.info && Date.now() - m.info.at < QUIET_MS) return m.info.value;
  const state = await readState();
  const since = state.desk?.address === setOf(s) ? state.desk.since : Date.now();

  const decimals = await s.pub.readContract({ address: s.token, abi: erc20, functionName: "decimals" }).catch(() => null);
  const one = async (agent: AgentId): Promise<AgentDeskInfo> => {
    const address = s.desks[agent];
    const base = { address, explorerAddress: `${s.explorer}/address/${address}` };
    if (decimals === null) return { ...base, holds: null, solvent: null };
    try {
      const [held, solvent] = await Promise.all([
        s.pub.readContract({ address: s.token, abi: erc20, functionName: "balanceOf", args: [address] }),
        s.pub.readContract({ address, abi, functionName: "solvent" }) as Promise<boolean>,
      ]);
      return { ...base, holds: Number(held / BigInt(10) ** BigInt(decimals - 2)) / 100, solvent };
    } catch {
      return { ...base, holds: null, solvent: null };
    }
  };
  const all = await Promise.all(AGENT_ORDER.map(one));
  const agents = Object.fromEntries(AGENT_ORDER.map((a, i) => [a, all[i]])) as DeskInfo["agents"];
  const read = all.every((d) => d.holds !== null);
  const value: DeskInfo = {
    network: s.name,
    explorerTx: `${s.explorer}/tx/{id}`,
    agents,
    holds: read ? round2(all.reduce((t, d) => t + (d.holds ?? 0), 0)) : null,
    solvent: read ? all.every((d) => d.solvent) : null,
    since,
  };
  m.info = { at: Date.now(), value };
  return value;
}
