/**
 * The council's paper portfolio. Pure functions, shared by server and UI.
 *
 * Each agent manages its own cash. A position is funded by stakes from one or
 * more agents, and its value and PnL are split between them by stake.
 */
import { AGENT_ORDER } from "./agents";
import type { Token } from "./market";
import type { AgentId } from "./types";

export const EMOTIONS = ["neutral", "confident", "excited", "skeptical", "worried", "annoyed", "happy", "sad"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** USDC each agent starts with. */
export const START_CASH = 100;
export const POOL_START = START_CASH * AGENT_ORDER.length;
/** Smallest order the desk will place. */
export const MIN_ORDER_USD = 10;
/** No single token may exceed this share of the pool. */
export const MAX_POSITION_SHARE = 0.4;
/** A position must be held this many rounds before the council may sell it. */
export const MIN_HOLD_ROUNDS = 2;

export type Stakes = Record<AgentId, number>;

export interface Position {
  token: Token;
  qty: number;
  /** USDC paid for the quantity still held. */
  cost: number;
  entryPrice: number;
  /** Each agent's share of `cost`, in USDC. */
  stake: Stakes;
  stop: number;
  target: number;
  openedRound: number;
  openedAt: number;
  leader: AgentId;
}

export interface Portfolio {
  cash: Stakes;
  positions: Position[];
}

export type FillReason = "COUNCIL" | "STOP" | "TARGET";

export interface Fill {
  id: string;
  round: number;
  ts: number;
  side: "BUY" | "SELL";
  token: Token;
  qty: number;
  price: number;
  usd: number;
  reason: FillReason;
  /** Agent who led the trade. Risk exits carry the agent who opened the position. */
  leader: AgentId;
  /** PnL booked by this fill. Null for buys. */
  realized: number | null;
  /** USDC each agent put in (buy) or got back (sell). */
  stake: Stakes;
}

export const zeroStakes = (): Stakes => ({ quant: 0, degen: 0, guardian: 0, oracle: 0 });

export const newPortfolio = (): Portfolio => ({
  cash: { quant: START_CASH, degen: START_CASH, guardian: START_CASH, oracle: START_CASH },
  positions: [],
});

const sum = (s: Stakes) => AGENT_ORDER.reduce((t, a) => t + s[a], 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const mapStakes = (fn: (a: AgentId) => number): Stakes => {
  const out = zeroStakes();
  for (const a of AGENT_ORDER) out[a] = fn(a);
  return out;
};

export const positionOf = (p: Portfolio, token: string) => p.positions.find((x) => x.token === token);

export const positionValue = (pos: Position, price: number) => pos.qty * price;
export const unrealized = (pos: Position, price: number) => positionValue(pos, price) - pos.cost;

type Prices = Partial<Record<Token, number>>;
/** Falls back to entry price when no live price is available, so PnL reads zero rather than wrong. */
const mark = (pos: Position, prices: Prices) => prices[pos.token] ?? pos.entryPrice;

/** What one agent's holdings are worth: cash plus its share of every open position. */
export function agentEquity(p: Portfolio, agent: AgentId, prices: Prices): number {
  let total = p.cash[agent];
  for (const pos of p.positions) {
    if (pos.cost > 0) total += (pos.stake[agent] / pos.cost) * positionValue(pos, mark(pos, prices));
  }
  return total;
}

export const agentPnl = (p: Portfolio, agent: AgentId, prices: Prices) => agentEquity(p, agent, prices) - START_CASH;
export const poolEquity = (p: Portfolio, prices: Prices) => AGENT_ORDER.reduce((t, a) => t + agentEquity(p, a, prices), 0);
export const poolCash = (p: Portfolio) => sum(p.cash);

/** Whether the council is allowed to sell this token in this round. */
export function canSell(p: Portfolio, token: string, round: number): boolean {
  const pos = positionOf(p, token);
  return !!pos && round - pos.openedRound >= MIN_HOLD_ROUNDS;
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
  token: Token;
  price: number;
  stakes: Stakes;
  stopPct: number;
  targetPct: number;
  round: number;
  leader: AgentId;
  ts: number;
  id: string;
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
    stop: entryPrice * (1 - o.stopPct / 100),
    target: entryPrice * (1 + o.targetPct / 100),
    openedRound: held?.openedRound ?? o.round,
    openedAt: held?.openedAt ?? o.ts,
    leader: held?.leader ?? o.leader,
  };

  return {
    portfolio: {
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
      reason: "COUNCIL",
      leader: o.leader,
      realized: null,
      stake: o.stakes,
    },
  };
}

interface SellOrder {
  token: Token;
  price: number;
  /** Share of the position to sell, 0..1. */
  fraction: number;
  reason: FillReason;
  round: number;
  leader: AgentId;
  ts: number;
  id: string;
}

/** Sells part or all of a held position and pays each agent its share of the proceeds. */
export function sell(p: Portfolio, o: SellOrder): { portfolio: Portfolio; fill: Fill } | null {
  const held = positionOf(p, o.token);
  if (!held || held.qty <= 0) return null;
  const fraction = Math.min(Math.max(o.fraction, 0), 1);
  if (fraction === 0) return null;

  const qty = held.qty * fraction;
  const usd = qty * o.price;
  const costOut = held.cost * fraction;
  const payout = mapStakes((a) => (held.stake[a] / held.cost) * usd);

  const rest = p.positions.filter((x) => x.token !== o.token);
  if (fraction < 1) {
    rest.push({
      ...held,
      qty: held.qty - qty,
      cost: held.cost - costOut,
      stake: mapStakes((a) => held.stake[a] * (1 - fraction)),
    });
  }

  return {
    portfolio: { cash: mapStakes((a) => round2(p.cash[a] + payout[a])), positions: rest },
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
    },
  };
}
