/**
 * The council's books. Pure functions, shared by server and UI.
 *
 * Each agent manages its own cash. A position in a token can be held by one agent or by
 * several. Each holds the tokens its own money bought, and gains or loses on those.
 */
import { AGENT_ORDER } from "./agents";
import type { AssetKey, Prices } from "./market";
import type { AgentId } from "./types";

export const EMOTIONS = ["neutral", "confident", "excited", "skeptical", "worried", "annoyed", "happy", "sad"] as const;
export type Emotion = (typeof EMOTIONS)[number];

const startCash = Number(process.env.NEXT_PUBLIC_START_CASH);
/**
 * USDG the house gives each agent to start with: 100, or NEXT_PUBLIC_START_CASH for a desk that
 * starts smaller or larger. The pages count with it too, so it is fixed when the site is built.
 */
export const START_CASH = startCash >= 10 ? Math.floor(startCash) : 100;
/** Smallest order the desk will place: a tenth of an agent's starting cash. */
export const MIN_ORDER_USD = Math.max(1, Math.round(START_CASH / 10));
/** No single token may exceed this share of the pool. */
export const MAX_POSITION_SHARE = 0.4;
/** A position must be held this many rounds before the council may sell it. */
export const MIN_HOLD_ROUNDS = 2;
/** An agent may sell its own tokens from the round after it bought them. */
export const MIN_OWN_HOLD_ROUNDS = 1;
/**
 * A position bought on an agent's commitment to a funder is held this many rounds before the
 * council may sell it. Its stop-loss and target still close it at any time.
 */
export const COMMITTED_HOLD_ROUNDS = 12;
/** The most of its cash an agent may put into one trade for its own book. */
export const OWN_BOOK_SHARE = 0.6;
/** What an agent with no position puts on at least, when the desk tells it to open one. */
export const STARTER_USD = 2 * MIN_ORDER_USD;

export type Stakes = Record<AgentId, number>;

export interface Position {
  token: AssetKey;
  qty: number;
  /** USDG paid for the quantity still held. */
  cost: number;
  entryPrice: number;
  /** Each agent's share of `cost`, in USDG. */
  stake: Stakes;
  /** Tokens each agent holds. A position opened before this was kept has none, and its tokens are split by stake. */
  units?: Stakes;
  stop: number;
  target: number;
  openedRound: number;
  openedAt: number;
  leader: AgentId;
  /** First round in which the council may sell it, when it was bought on a commitment to a funder. */
  lockedUntil?: number;
  /** How far below the price the stop was set when the position was opened, in percent. The stop follows the price up at this distance. */
  trail?: number;
  /** The highest price seen since the position was opened. */
  peak?: number;
}

export interface Portfolio {
  cash: Stakes;
  /** Money put into each agent and not taken out: the house's starting cash plus users' net funding. */
  capital: Stakes;
  /** Shares outstanding in each agent. The house holds START_CASH of them; users buy and redeem the rest. */
  shares: Stakes;
  positions: Position[];
}

/** OWN: an agent's trade for its own book, made without a vote. */
/** FALLING: an agent sold its own tokens because the price was falling fast. */
export type FillReason = "COUNCIL" | "OWN" | "STOP" | "TARGET" | "FALLING";

export interface Fill {
  id: string;
  round: number;
  ts: number;
  side: "BUY" | "SELL";
  token: AssetKey;
  qty: number;
  price: number;
  usd: number;
  reason: FillReason;
  /** Agent who led the trade. Risk exits carry the agent who opened the position. */
  leader: AgentId;
  /** PnL booked by this fill. Null for buys. */
  realized: number | null;
  /** The transaction that recorded the trade on Robinhood Chain, once there is one. */
  tx?: string;
  /** Set when the trade could not be put on-chain, and no more tries will be made. */
  unrecorded?: boolean;
  /** USDG each agent put in (buy) or got back (sell). */
  stake: Stakes;
  /** Tokens each agent bought or sold. */
  units?: Stakes;
  /** A sale: the share of the position that was sold, 1 for all of it. */
  fraction?: number;
  /** What happened, in a sentence, for a sale an agent made between sessions. */
  note?: string;
  /** The transaction on each agent's own desk contract, once there is one. `tx` is the first of them. */
  txs?: Partial<Record<AgentId, string>>;
}

/** A sale at a stop that had followed the price up above the entry. It is on record as a stop, and books a gain. */
export const trailed = (f: Fill) => f.reason === "STOP" && (f.realized ?? 0) > 0.005;

export const zeroStakes = (): Stakes => ({ quant: 0, degen: 0, guardian: 0, oracle: 0 });

const startStakes = (): Stakes => ({ quant: START_CASH, degen: START_CASH, guardian: START_CASH, oracle: START_CASH });

export const newPortfolio = (): Portfolio => ({ cash: startStakes(), capital: startStakes(), shares: startStakes(), positions: [] });

/** Fills in fields that older saved portfolios don't have. */
export const normalizePortfolio = (p: Portfolio): Portfolio => ({
  ...p,
  capital: p.capital ?? startStakes(),
  shares: p.shares ?? startStakes(),
});

const sum = (s: Stakes) => AGENT_ORDER.reduce((t, a) => t + s[a], 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const mapStakes = (fn: (a: AgentId) => number): Stakes => {
  const out = zeroStakes();
  for (const a of AGENT_ORDER) out[a] = fn(a);
  return out;
};

export const positionOf = (p: Portfolio, token: string) => p.positions.find((x) => x.token === token);

/** Tokens of the position that are this agent's. */
export const unitsOf = (pos: Position, agent: AgentId) => pos.units?.[agent] ?? (pos.cost > 0 ? (pos.stake[agent] / pos.cost) * pos.qty : 0);

export const positionValue = (pos: Position, price: number) => pos.qty * price;
export const unrealized = (pos: Position, price: number) => positionValue(pos, price) - pos.cost;

/** Falls back to entry price when no live price is available, so PnL reads zero rather than wrong. */
const mark = (pos: Position, prices: Prices) => prices[pos.token] ?? pos.entryPrice;

/** What one agent's holdings are worth: cash plus its share of every open position. */
export function agentEquity(p: Portfolio, agent: AgentId, prices: Prices): number {
  let total = p.cash[agent];
  for (const pos of p.positions) total += unitsOf(pos, agent) * mark(pos, prices);
  return total;
}

export const agentPnl = (p: Portfolio, agent: AgentId, prices: Prices) => agentEquity(p, agent, prices) - p.capital[agent];

/** Value of one share of an agent. Starts at 1 and moves with the agent's results. */
export const agentNav = (p: Portfolio, agent: AgentId, prices: Prices) =>
  p.shares[agent] > 0 ? agentEquity(p, agent, prices) / p.shares[agent] : 1;

/** Money users have put into an agent, beyond the house's starting cash. */
export const userFunding = (p: Portfolio, agent: AgentId) => Math.max(0, p.capital[agent] - START_CASH);

export const poolCapital = (p: Portfolio) => sum(p.capital);
export const poolEquity = (p: Portfolio, prices: Prices) => AGENT_ORDER.reduce((t, a) => t + agentEquity(p, a, prices), 0);
export const poolCash = (p: Portfolio) => sum(p.cash);

/** Agents with money in a position. */
export const holders = (pos: Position): AgentId[] => AGENT_ORDER.filter((a) => pos.stake[a] > 0.005);

/** Whether the agent holds this position by itself, and so may sell it on its own decision. */
export const holdsAlone = (pos: Position, agent: AgentId) => {
  const h = holders(pos);
  return h.length === 1 && h[0] === agent;
};

/** Whether the agent may sell its own tokens of this position in this round, on its own decision. */
export function canSellOwn(p: Portfolio, token: string, agent: AgentId, round: number): boolean {
  const pos = positionOf(p, token);
  return !!pos && pos.stake[agent] > 0.005 && round - pos.openedRound >= MIN_OWN_HOLD_ROUNDS && round >= (pos.lockedUntil ?? 0);
}

/** Whether the agent has money in any open position. `counts` leaves out positions that are not to count. */
export const invested = (p: Portfolio, agent: AgentId, counts: (pos: Position) => boolean = () => true) => p.positions.some((pos) => pos.stake[agent] > 0.005 && counts(pos));

/** Whether the council is allowed to sell this token in this round. */
export function canSell(p: Portfolio, token: string, round: number): boolean {
  const pos = positionOf(p, token);
  return !!pos && round - pos.openedRound >= MIN_HOLD_ROUNDS && round >= (pos.lockedUntil ?? 0);
}

/**
 * Trims requested stakes to what is allowed: no more than each agent's cash, and
 * no position above MAX_POSITION_SHARE of the pool. Returns zeros if the order
 * would fall under the minimum size.
 */
export function fitStakes(p: Portfolio, token: string, wanted: Stakes, prices: Prices): Stakes {
  const capped = mapStakes((a) => Math.max(0, Math.min(wanted[a], p.cash[a])));
  const held = positionOf(p, token);
  const room = MAX_POSITION_SHARE * poolEquity(p, prices) - (held ? positionValue(held, mark(held, prices)) : 0);
  const total = sum(capped);
  const scale = total > room ? Math.max(room, 0) / total : 1;
  const fitted = mapStakes((a) => Math.floor(capped[a] * scale * 100) / 100);
  return sum(fitted) >= MIN_ORDER_USD ? fitted : zeroStakes();
}

interface BuyOrder {
  token: AssetKey;
  price: number;
  stakes: Stakes;
  stopPct: number;
  targetPct: number;
  round: number;
  leader: AgentId;
  ts: number;
  id: string;
  /** Bought on a commitment to a funder, so the council may not sell it for a while. */
  committed?: boolean;
  /** Why the purchase was made. The council's, unless said otherwise. */
  reason?: FillReason;
  /** Adding to a position leaves its stop and target where its holders set them. */
  keepTerms?: boolean;
}

/** Opens a position, or adds to the one already held in that token. */
export function buy(p: Portfolio, o: BuyOrder): { portfolio: Portfolio; fill: Fill } {
  const usd = round2(sum(o.stakes));
  const qty = usd / o.price;
  const held = positionOf(p, o.token);
  const cost = (held?.cost ?? 0) + usd;
  const totalQty = (held?.qty ?? 0) + qty;
  const entryPrice = cost / totalQty;

  const position: Position = {
    token: o.token,
    qty: totalQty,
    cost,
    entryPrice,
    stake: mapStakes((a) => (held?.stake[a] ?? 0) + o.stakes[a]),
    units: mapStakes((a) => (held ? unitsOf(held, a) : 0) + o.stakes[a] / o.price),
    stop: held && o.keepTerms ? held.stop : entryPrice * (1 - o.stopPct / 100),
    target: held && o.keepTerms ? held.target : entryPrice * (1 + o.targetPct / 100),
    openedRound: held?.openedRound ?? o.round,
    openedAt: held?.openedAt ?? o.ts,
    leader: held?.leader ?? o.leader,
    lockedUntil: o.committed ? o.round + COMMITTED_HOLD_ROUNDS : held?.lockedUntil,
    trail: held && o.keepTerms ? held.trail : o.stopPct,
    // New terms start the stop's climb over again, from the new entry.
    peak: held && o.keepTerms ? held.peak : undefined,
  };

  return {
    portfolio: {
      ...p,
      cash: mapStakes((a) => round2(p.cash[a] - o.stakes[a])),
      positions: [...p.positions.filter((x) => x.token !== o.token), position],
    },
    fill: {
      id: o.id,
      round: o.round,
      ts: o.ts,
      side: "BUY",
      token: o.token,
      qty,
      price: o.price,
      usd,
      reason: o.reason ?? "COUNCIL",
      leader: o.leader,
      realized: null,
      stake: o.stakes,
      units: mapStakes((a) => o.stakes[a] / o.price),
    },
  };
}

interface SellOrder {
  token: AssetKey;
  price: number;
  /** Share of the position to sell, 0..1. */
  fraction: number;
  reason: FillReason;
  round: number;
  leader: AgentId;
  ts: number;
  id: string;
  /** Sells this agent's tokens only, and leaves the other holders' where they are. */
  only?: AgentId;
}

/**
 * Sells part or all of a held position and pays each seller for the tokens it sold.
 * `fraction` is the share of their tokens that the sellers sell.
 */
export function sell(p: Portfolio, o: SellOrder): { portfolio: Portfolio; fill: Fill } | null {
  const held = positionOf(p, o.token);
  if (!held || held.qty <= 0) return null;
  const fraction = Math.min(Math.max(o.fraction, 0), 1);
  if (fraction === 0) return null;

  const sells = (a: AgentId) => !o.only || a === o.only;
  const sold = mapStakes((a) => (sells(a) ? unitsOf(held, a) * fraction : 0));
  const costOf = mapStakes((a) => (sells(a) ? held.stake[a] * fraction : 0));
  const qty = sum(sold);
  if (qty <= 0) return null;
  const usd = qty * o.price;
  const costOut = sum(costOf);
  const payout = mapStakes((a) => sold[a] * o.price);

  const rest = p.positions.filter((x) => x.token !== o.token);
  const left = held.qty - qty;
  if (left > held.qty * 1e-9) {
    const stake = mapStakes((a) => held.stake[a] - costOf[a]);
    // If the agent who opened the position has left it, the largest holder answers for it.
    const stays = stake[held.leader] > 0.005 ? held.leader : [...AGENT_ORDER].sort((a, b) => stake[b] - stake[a])[0];
    rest.push({
      ...held,
      qty: left,
      cost: held.cost - costOut,
      entryPrice: (held.cost - costOut) / left,
      stake,
      units: mapStakes((a) => unitsOf(held, a) - sold[a]),
      leader: stays,
    });
  }

  return {
    portfolio: { ...p, cash: mapStakes((a) => round2(p.cash[a] + payout[a])), positions: rest },
    fill: {
      id: o.id,
      round: o.round,
      ts: o.ts,
      side: "SELL",
      token: o.token,
      qty,
      price: o.price,
      usd: round2(usd),
      reason: o.reason,
      leader: o.leader,
      realized: round2(usd - costOut),
      stake: mapStakes((a) => round2(payout[a])),
      units: sold,
      fraction,
    },
  };
}

/** A user funds an agent: the cash goes to the agent, and the user gets shares at the current value. */
export function fundIn(p: Portfolio, agent: AgentId, usd: number, prices: Prices): { portfolio: Portfolio; shares: number; nav: number } {
  const nav = agentNav(p, agent, prices);
  const shares = usd / nav;
  return {
    nav,
    shares,
    portfolio: {
      ...p,
      cash: { ...p.cash, [agent]: round2(p.cash[agent] + usd) },
      capital: { ...p.capital, [agent]: round2(p.capital[agent] + usd) },
      shares: { ...p.shares, [agent]: p.shares[agent] + shares },
    },
  };
}

/**
 * A user redeems shares for cash at the current value. Fails if the agent's cash is
 * tied up in open positions; the user can redeem what is free or wait for the position to close.
 */
export function fundOut(
  p: Portfolio,
  agent: AgentId,
  shares: number,
  prices: Prices,
): { ok: true; portfolio: Portfolio; usd: number; nav: number } | { ok: false; freeUsd: number; nav: number } {
  const nav = agentNav(p, agent, prices);
  const usd = Math.floor(shares * nav * 100) / 100;
  if (usd > p.cash[agent]) return { ok: false, freeUsd: p.cash[agent], nav };
  return {
    ok: true,
    nav,
    usd,
    portfolio: {
      ...p,
      cash: { ...p.cash, [agent]: round2(p.cash[agent] - usd) },
      capital: { ...p.capital, [agent]: round2(p.capital[agent] - usd) },
      shares: { ...p.shares, [agent]: Math.max(0, p.shares[agent] - shares) },
    },
  };
}
