import { AGENT_ORDER } from "./agents";
import type { Fill, FillReason, Stakes } from "./council";
import type { AgentId } from "./types";

/**
 * The desk's figures as the public pages show them: a demo book, the way gomo.bot shows one.
 *
 * The pool's capital and what each agent was funded with are the fixed values here. Each agent's
 * result is what the sample trades below made for its book, and the council's result is the four
 * added up: put more trades on the books and both rise. The desk's own books are kept by the server,
 * which runs the sessions, settles the trades and records them on the agents' contracts; the page adds
 * what those trades make or cost to the figures here (src/lib/use-showcase.ts). The conversation, the
 * prices and the desk's own trades on the page are its own.
 */
export const SHOWCASE = {
  /** What the pool started with. */
  capital: 5000,
  /** What users put behind each agent. */
  funded: { quant: 74, degen: 72, guardian: 60, oracle: 57 } as Record<AgentId, number>,
};

/** What the generated sample trades add up to. Trades added by hand in MORE_TRADES come on top. */
const SAMPLE_RESULT = 433.18;

const sum = (r: Record<AgentId, number>) => AGENT_ORDER.reduce((t, a) => t + r[a], 0);

export const SHOWCASE_FUNDED = sum(SHOWCASE.funded);
/** Each agent's share of the capital. */
export const SHOWCASE_AGENT_CAPITAL = SHOWCASE.capital / AGENT_ORDER.length;

// --- sample trades -------------------------------------------------------------------------------

/** How many sample trades there are, over how many days. Each is a purchase and a sale: two orders. */
const SAMPLE_COUNT = 210;
const SAMPLE_DAYS = 21;

/** The tokens the sample trades are in, with a price each. Entries vary around it. */
const SAMPLE_TOKENS: Array<[string, number]> = [
  ["VRAX", 0.041],
  ["MOCA", 0.0071],
  ["PEPU", 0.0000934],
  ["NOVA", 0.184],
  ["KAIJU", 0.00308],
  ["DRIFT", 0.0562],
  ["ORBIT", 0.0127],
  ["SNEK", 0.000612],
  ["SUITED", 0.000084],
  ["PAIR", 0.000162],
  ["OYSTER", 0.00045],
  ["DOTS", 0.0003],
  ["ANYR", 0.0001],
  ["SCROOGE", 0.00033],
];

/** A small, fixed random sequence, so the sample trades are the same on every visit. */
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
const between = (next: () => number, lo: number, hi: number) => lo + next() * (hi - lo);
const pick = <T,>(next: () => number, from: readonly T[]) => from[Math.floor(next() * from.length)];
const cents = (n: number) => Math.round(n * 100) / 100;

/** Who is in a trade and with what share: the council (the leader half, two others a quarter each), a pair, or the leader alone. */
function shares(next: () => number, leader: AgentId): Stakes {
  const at = AGENT_ORDER.indexOf(leader);
  const others = [AGENT_ORDER[(at + 1) % 4], AGENT_ORDER[(at + 2) % 4], AGENT_ORDER[(at + 3) % 4]];
  const r = next();
  const out: Stakes = { quant: 0, degen: 0, guardian: 0, oracle: 0 };
  if (r < 0.6) {
    out[leader] = 0.5;
    out[others[0]] = 0.25;
    out[others[1]] = 0.25;
  } else if (r < 0.85) {
    out[leader] = 0.6;
    out[pick(next, others)] = 0.4;
  } else out[leader] = 1;
  return out;
}

const scale = (shares: Stakes, usd: number): Stakes => ({ quant: shares.quant * usd, degen: shares.degen * usd, guardian: shares.guardian * usd, oracle: shares.oracle * usd });
const parties = (stake: Stakes) => AGENT_ORDER.filter((a) => stake[a] > 0);

interface SampleTrade {
  token: string;
  leader: AgentId;
  shares: Stakes;
  usd: number;
  entry: number;
  realized: number;
  buyReason: FillReason;
  sellReason: FillReason;
  /** Minutes before the page opened. */
  bought: number;
  sold: number;
}

/**
 * Trades to put on the books by hand, on top of the generated ones. Each adds to its agents' results and so to
 * the council's. `shares` is who is in it: the leader half and two others a quarter each, if not given.
 */
const MORE_TRADES: Array<Omit<SampleTrade, "shares"> & { shares?: Stakes }> = [];

/** The council's usual split: the leader half, the next two agents a quarter each. */
function councilShares(leader: AgentId): Stakes {
  const at = AGENT_ORDER.indexOf(leader);
  const out: Stakes = { quant: 0, degen: 0, guardian: 0, oracle: 0 };
  out[leader] = 0.5;
  out[AGENT_ORDER[(at + 1) % 4]] = 0.25;
  out[AGENT_ORDER[(at + 2) % 4]] = 0.25;
  return out;
}

/**
 * The sample trades: sizes that fit the pool above, spread over the last weeks, nine in ten closed at a gain.
 * The generated ones add up to SAMPLE_RESULT; the ones in MORE_TRADES come on top.
 */
function sampleTrades(): SampleTrade[] {
  const next = seeded(20260930);
  const trades: SampleTrade[] = [];
  const span = SAMPLE_DAYS * 24 * 60;
  let sold = between(next, 20, 90);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const [token, base] = pick(next, SAMPLE_TOKENS);
    const leader = pick(next, AGENT_ORDER);
    const share = shares(next, leader);
    const alone = parties(share).length === 1;
    const usd = Math.round(between(next, alone ? 40 : 60, alone ? 160 : 320));
    const entry = base * between(next, 0.7, 1.3);
    const gain = next() < 0.92;
    const pct = gain ? between(next, 2, 16) : -between(next, 1, 5);
    const held = between(next, 40, 420);
    trades.push({
      token,
      leader,
      shares: share,
      usd,
      entry,
      realized: (usd * pct) / 100,
      buyReason: alone ? "OWN" : "COUNCIL",
      sellReason: gain ? (next() < 0.7 ? "TARGET" : alone ? "OWN" : "COUNCIL") : next() < 0.6 ? "STOP" : next() < 0.7 ? "FALLING" : alone ? "OWN" : "COUNCIL",
      bought: sold + held,
      sold,
    });
    sold += between(next, 0.4, 1.6) * (span / SAMPLE_COUNT);
  }
  // The generated results add up to SAMPLE_RESULT, to the cent.
  const raw = trades.reduce((t, x) => t + x.realized, 0);
  const factor = SAMPLE_RESULT / raw;
  for (const t of trades) t.realized = cents(t.realized * factor);
  const off = cents(SAMPLE_RESULT - trades.reduce((t, x) => t + x.realized, 0));
  trades[0].realized = cents(trades[0].realized + off);
  return [...trades, ...MORE_TRADES.map((t) => ({ ...t, shares: t.shares ?? councilShares(t.leader) }))];
}

const TRADES = sampleTrades();

/** Each agent's result: its share of what every sample trade on its book made or lost. */
const RESULT = (() => {
  const out: Record<AgentId, number> = { quant: 0, degen: 0, guardian: 0, oracle: 0 };
  for (const t of TRADES) for (const a of AGENT_ORDER) out[a] += t.realized * t.shares[a];
  for (const a of AGENT_ORDER) out[a] = cents(out[a]);
  return out;
})();

export const showcaseResult = (id: AgentId) => RESULT[id];
/** An agent's result as a percentage of its capital. */
export const showcasePct = (id: AgentId) => (RESULT[id] / SHOWCASE_AGENT_CAPITAL) * 100;
/** The council's result: the four agents' results added up. */
export const SHOWCASE_PNL = cents(sum(RESULT));
/** The pool's equity: its capital and its result. */
export const SHOWCASE_EQUITY = SHOWCASE.capital + SHOWCASE_PNL;

/**
 * The sample trades as orders for the trade lists, newest first, timed from when the page opened.
 * Each carries a transaction hash for every agent in it. The hashes are samples too, and the lists show
 * them as text: they open nothing.
 */
export function sampleFills(now: number): Fill[] {
  const next = seeded(20261001);
  const fills: Fill[] = [];
  TRADES.forEach((t, i) => {
    const qty = t.usd / t.entry;
    const exit = t.entry * (1 + t.realized / t.usd);
    const bought = scale(t.shares, t.usd);
    const sold = scale(t.shares, t.usd + t.realized);
    const txsFor = (stake: Stakes) => Object.fromEntries(parties(stake).map((a) => [a, hashOf(next)])) as Partial<Record<AgentId, string>>;
    const buyTxs = txsFor(bought);
    const sellTxs = txsFor(sold);
    fills.push(
      {
        id: `sample-${i}-buy`,
        round: 0,
        ts: now - Math.round(t.bought) * 60_000,
        side: "BUY",
        token: t.token,
        qty,
        price: t.entry,
        usd: t.usd,
        reason: t.buyReason,
        leader: t.leader,
        realized: null,
        stake: bought,
        tx: buyTxs[t.leader],
        txs: buyTxs,
      },
      {
        id: `sample-${i}-sell`,
        round: 0,
        ts: now - Math.round(t.sold) * 60_000,
        side: "SELL",
        token: t.token,
        qty,
        price: exit,
        usd: cents(t.usd + t.realized),
        reason: t.sellReason,
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
