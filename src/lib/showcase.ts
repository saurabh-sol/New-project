import { AGENT_ORDER } from "./agents";
import type { Fill, FillReason, Stakes } from "./council";
import type { AgentId } from "./types";

/**
 * The desk's figures as the public pages show them: a demo book, the way gomo.bot shows one.
 *
 * The pool, the council's result, each agent's result and what it was funded with are the fixed
 * values here. The desk's own books are kept by the server, which runs the sessions, settles the
 * trades and records them on the agents' contracts; none of that moves these figures. The
 * conversation, the prices and the trades on the page are the desk's own.
 */
export const SHOWCASE = {
  /** What the pool started with. */
  capital: 5000,
  /** Each agent's result on its share of the capital. They add up to the council's result. */
  result: { quant: 186.4, degen: 97.15, guardian: 61.8, oracle: 87.83 } as Record<AgentId, number>,
  /** What users put behind each agent. */
  funded: { quant: 1300, degen: 1250, guardian: 1050, oracle: 1000 } as Record<AgentId, number>,
};

const sum = (r: Record<AgentId, number>) => AGENT_ORDER.reduce((t, a) => t + r[a], 0);

/** The council's result: what the pool has made on its capital. */
export const SHOWCASE_PNL = Math.round(sum(SHOWCASE.result) * 100) / 100;
/** The pool's equity: its capital and its result. */
export const SHOWCASE_EQUITY = SHOWCASE.capital + SHOWCASE_PNL;
export const SHOWCASE_FUNDED = sum(SHOWCASE.funded);
/** Each agent's share of the capital. */
export const SHOWCASE_AGENT_CAPITAL = SHOWCASE.capital / AGENT_ORDER.length;

export const showcaseResult = (id: AgentId) => SHOWCASE.result[id];
/** An agent's result as a percentage of its capital. */
export const showcasePct = (id: AgentId) => (SHOWCASE.result[id] / SHOWCASE_AGENT_CAPITAL) * 100;

// --- sample trades -------------------------------------------------------------------------------

interface SampleTrade {
  token: string;
  leader: AgentId;
  /** USDG put into the purchase. */
  usd: number;
  entry: number;
  /** What the sale booked. The exit price follows from it. */
  realized: number;
  reason: FillReason;
  /** Minutes before the page opened that the purchase and the sale were made. */
  bought: number;
  sold: number;
}

/** Sizes fit the pool above. The results add up to the council's result. */
const SAMPLE_TRADES: SampleTrade[] = [
  { token: "VRAX", leader: "quant", usd: 320, entry: 0.0418, realized: 61.4, reason: "TARGET", bought: 1710, sold: 1560 },
  { token: "MOCA", leader: "degen", usd: 450, entry: 0.00721, realized: 48.75, reason: "COUNCIL", bought: 1620, sold: 1450 },
  { token: "PEPU", leader: "oracle", usd: 260, entry: 0.0000934, realized: -22.1, reason: "STOP", bought: 1500, sold: 1400 },
  { token: "NOVA", leader: "guardian", usd: 380, entry: 0.184, realized: 37.9, reason: "TARGET", bought: 1380, sold: 1230 },
  { token: "KAIJU", leader: "degen", usd: 540, entry: 0.00308, realized: 84.2, reason: "TARGET", bought: 1290, sold: 1080 },
  { token: "DRIFT", leader: "quant", usd: 240, entry: 0.0562, realized: -15.65, reason: "FALLING", bought: 1150, sold: 1040 },
  { token: "ORBIT", leader: "oracle", usd: 410, entry: 0.0127, realized: 52.3, reason: "COUNCIL", bought: 990, sold: 840 },
  { token: "SNEK", leader: "guardian", usd: 300, entry: 0.000612, realized: 29.85, reason: "TARGET", bought: 900, sold: 720 },
  { token: "MOCA", leader: "quant", usd: 350, entry: 0.00698, realized: -31.4, reason: "STOP", bought: 780, sold: 640 },
  { token: "VRAX", leader: "degen", usd: 520, entry: 0.0397, realized: 66.15, reason: "TARGET", bought: 600, sold: 430 },
  { token: "NOVA", leader: "oracle", usd: 330, entry: 0.191, realized: 45.08, reason: "COUNCIL", bought: 470, sold: 300 },
  { token: "KAIJU", leader: "quant", usd: 560, entry: 0.00296, realized: 76.7, reason: "TARGET", bought: 330, sold: 140 },
];

/** A small, fixed random sequence, so the sample hashes are the same on every visit. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashOf = (next: () => number) => "0x" + Array.from({ length: 64 }, () => Math.floor(next() * 16).toString(16)).join("");

/** The leader puts in half, the two agents after it a quarter each. */
function split(leader: AgentId, usd: number): Stakes {
  const at = AGENT_ORDER.indexOf(leader);
  const joiners = [AGENT_ORDER[(at + 1) % 4], AGENT_ORDER[(at + 2) % 4]];
  const stake: Stakes = { quant: 0, degen: 0, guardian: 0, oracle: 0 };
  stake[leader] = usd / 2;
  for (const j of joiners) stake[j] = usd / 4;
  return stake;
}

const parties = (stake: Stakes) => AGENT_ORDER.filter((a) => stake[a] > 0);

/**
 * The sample trades as orders for the trade list, newest first, timed from when the page opened.
 * Each carries a transaction hash for every agent in it. The hashes are samples too, and the list shows
 * them as text: they open nothing.
 */
export function sampleFills(now: number): Fill[] {
  const next = seeded(20260930);
  const fills: Fill[] = [];
  SAMPLE_TRADES.forEach((t, i) => {
    const qty = t.usd / t.entry;
    const exit = t.entry * (1 + t.realized / t.usd);
    const bought = split(t.leader, t.usd);
    const sold = split(t.leader, t.usd + t.realized);
    const txsFor = (stake: Stakes) => Object.fromEntries(parties(stake).map((a) => [a, hashOf(next)])) as Partial<Record<AgentId, string>>;
    const buyTxs = txsFor(bought);
    const sellTxs = txsFor(sold);
    fills.push(
      {
        id: `sample-${i}-buy`,
        round: 0,
        ts: now - t.bought * 60_000,
        side: "BUY",
        token: t.token,
        qty,
        price: t.entry,
        usd: t.usd,
        reason: "COUNCIL",
        leader: t.leader,
        realized: null,
        stake: bought,
        tx: buyTxs[t.leader],
        txs: buyTxs,
      },
      {
        id: `sample-${i}-sell`,
        round: 0,
        ts: now - t.sold * 60_000,
        side: "SELL",
        token: t.token,
        qty,
        price: exit,
        usd: t.usd + t.realized,
        reason: t.reason,
        leader: t.leader,
        realized: t.realized,
        stake: sold,
        fraction: 1,
        tx: sellTxs[t.leader],
        txs: sellTxs,
      },
    );
  });
  return fills.sort((a, b) => b.ts - a.ts);
}
