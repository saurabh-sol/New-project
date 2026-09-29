/**
 * The council's paper portfolio. Pure functions, shared by server and UI.
 *
 * Each agent manages its own cash. A position is funded by stakes from one or
 * more agents, and its value and PnL are split between them by stake.
 */
import { AGENT_ORDER } from "./agents";
import type { AssetKey, Prices } from "./market";
import type { AgentId } from "./types";

export const EMOTIONS = ["neutral", "confident", "excited", "skeptical", "worried", "annoyed", "happy", "sad"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/** USDG the house gives each agent to start with. */
export const START_CASH = 100;
/** Smallest order the desk will place. */
export const MIN_ORDER_USD = 10;
/** No single token may exceed this share of the pool. */
export const MAX_POSITION_SHARE = 0.4;
/** A position must be held this many rounds before the council may sell it. */
export const MIN_HOLD_ROUNDS = 2;
/**
 * A position bought on an agent's commitment to a funder is held this many rounds before the
 * council may sell it. Its stop-loss and target still close it at any time.
 */
export const COMMITTED_HOLD_ROUNDS = 12;

export type Stakes = Record<AgentId, number>;

export interface Position {
  token: AssetKey;
  qty: number;
  /** USDG paid for the quantity still held. */
  cost: number;
  entryPrice: number;
  /** Each agent's share of `cost`, in USDG. */
  stake: Stakes;
  stop: number;
  target: number;
  openedRound: number;
  openedAt: number;
  leader: AgentId;
  /** First round in which the council may sell it, when it was bought on a commitment to a funder. */
  lockedUntil?: number;
}

export interface Portfolio {
  cash: Stakes;
  /** Money put into each agent and not taken out: the house's starting cash plus users' net funding. */
  capital: Stakes;
  /** Shares outstanding in each agent. The house holds START_CASH of them; users buy and redeem the rest. */
  shares: Stakes;
  positions: Position[];
}

export type FillReason = "COUNCIL" | "STOP" | "TARGET";

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
  /** USDG each agent put in (buy) or got back (sell). */
  stake: Stakes;
}

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

export const positionValue = (pos: Position, price: number) => pos.qty * price;
export const unrealized = (pos: Position, price: number) => positionValue(pos, price) - pos.cost;

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

export const agentPnl = (p: Portfolio, agent: AgentId, prices: Prices) => agentEquity(p, agent, prices) - p.capital[agent];

/** Value of one share of an agent. Starts at 1 and moves with the agent's results. */
export const agentNav = (p: Portfolio, agent: AgentId, prices: Prices) =>
  p.shares[agent] > 0 ? agentEquity(p, agent, prices) / p.shares[agent] : 1;

/** Money users have put into an agent, beyond the house's starting cash. */
export const userFunding = (p: Portfolio, agent: AgentId) => Math.max(0, p.capital[agent] - START_CASH);

export const poolCapital = (p: Portfolio) => sum(p.capital);
export const poolEquity = (p: Portfolio, prices: Prices) => AGENT_ORDER.reduce((t, a) => t + agentEquity(p, a, prices), 0);
export const poolCash = (p: Portfolio) => sum(p.cash);

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
    lockedUntil: o.committed ? o.round + COMMITTED_HOLD_ROUNDS : held?.lockedUntil,
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
      reason: "COUNCIL",
      leader: o.leader,
      realized: null,
      stake: o.stakes,
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
