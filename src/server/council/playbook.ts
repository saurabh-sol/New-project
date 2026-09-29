/**
 * The desk's trading skill, as far as it is enforced: which tokens may be bought, how large a
 * position may be, and how a stop follows the price up. `skill.md` says the same in words,
 * and is what the agents are given to read. The numbers here are the ones that bind.
 *
 * The rules come from the desk's own record. Of its first 41 closed trades, the 20 bought in the
 * upper part of the token's daily range lost 19 times, by 6.5% on average. The 21 bought lower
 * gained 4.2% on average. The rules refuse the first kind, and keep every position small.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { AGENTS } from "@/lib/agents";
import { agentEquity, MIN_ORDER_USD, positionOf, type Fill, type Portfolio, type Position } from "@/lib/council";
import type { TokenStats } from "@/lib/council-types";
import type { AssetKey, Prices } from "@/lib/market";
import type { AgentId } from "@/lib/types";

export const PLAYBOOK = {
  /** A token is not bought in the upper part of its 24-hour range: at or above this, in percent of the range. */
  maxRangePos: 60,
  /** Nor on an RSI at or above this, on 5-minute candles. */
  maxRsi: 70,
  /** Fewer trades than this in five minutes say nothing about who leads. */
  fewTrades: 6,
  /** What an agent may lose on one trade if its stop is hit, in percent of what the agent is worth. */
  riskPct: 1.5,
  /** A target stands at least this many times the stop's distance away. */
  reward: 2,
  /** An agent that sold a token at a loss does not buy it again for this many sessions. */
  coolRounds: 3,
  /** Once the stop has been raised, it stands at least this far above the entry, in percent: the position can no longer lose. */
  lockPct: 0.2,
} as const;

/** Why the desk will not buy this token now, or null if it may. */
export function entryProblem(s: TokenStats): string | null {
  // The rules read a pool's figures. A Stock Token, which a funder may ask for, has none of them.
  if (!s.pool) return null;
  if (s.rangePos >= PLAYBOOK.maxRangePos) return `at ${Math.round(s.rangePos)}% of its day's range, too high to buy`;
  if (s.rsi14 >= PLAYBOOK.maxRsi) return `RSI ${Math.round(s.rsi14)}, too hot to buy`;
  if (s.buys5m !== undefined && s.sells5m !== undefined && s.buys5m + s.sells5m >= PLAYBOOK.fewTrades && s.sells5m > s.buys5m) return `sellers lead, ${s.sells5m} sells to ${s.buys5m} buys`;
  return null;
}

/**
 * Why a holder would sell a token now, or null if it would hold: the price is down over five
 * and fifteen minutes, the trend is down, and sellers lead. Where too few trades were made to
 * tell who leads, the hour has to be down by as much as the token moves in half an hour.
 */
export function turned(s: TokenStats): string | null {
  if (!((s.change5m ?? s.change15m) < 0 && s.change15m < 0 && s.trend === "down")) return null;
  const told = s.buys5m !== undefined && s.sells5m !== undefined && s.buys5m + s.sells5m >= PLAYBOOK.fewTrades;
  if (told) return s.sells5m! > s.buys5m! ? `down ${Math.abs(s.change15m).toFixed(1)}% in 15 minutes, ${s.sells5m} sells to ${s.buys5m} buys, trend down` : null;
  return s.change1h <= -Math.max(3, s.atrPct * 6) ? `down ${Math.abs(s.change1h).toFixed(1)}% on the hour, trend down` : null;
}

/**
 * How much a token that passes the entry rules has to be said for it, from -1 to 1, by what
 * the skill prefers: buyers leading, volume above its average, a deep pool, a price turning
 * up, and room above it in the day's range.
 */
export function appeal(s: TokenStats): number {
  const unit = (n: number) => Math.min(Math.max(n, -1), 1);
  const traded = (s.buys5m ?? 0) + (s.sells5m ?? 0);
  const flow = traded >= PLAYBOOK.fewTrades ? ((s.buys5m ?? 0) - (s.sells5m ?? 0)) / traded : 0;
  const volume = unit(((s.volRatio ?? 1) - 1) / 1.5);
  const depth = s.pool ? unit(Math.log10(Math.max(s.pool.liquidityUsd, 1) / 100_000)) : 0;
  const turn = unit((s.change5m ?? s.change15m) / Math.max(s.atrPct, 0.5));
  const room = unit((50 - s.rangePos) / 50);
  return unit(flow * 0.35 + volume * 0.2 + depth * 0.15 + turn * 0.2 + room * 0.1);
}

/** The tokens on the board that the desk will not buy this session, each with the reason. */
export const refusedTokens = (stats: TokenStats[]): Record<AssetKey, string> =>
  Object.fromEntries(stats.flatMap((s) => (entryProblem(s) ? [[s.token, entryProblem(s)!] as const] : [])));

/**
 * The tokens this agent may not buy this session, for reasons of its own: it sold the token
 * at a loss a short while ago, or it holds the token at a loss and would be adding to it.
 */
export function barredTokens(agent: AgentId, portfolio: Portfolio, prices: Prices, fills: Fill[], round: number): Record<AssetKey, string> {
  const out: Record<AssetKey, string> = {};
  for (const f of fills) {
    if (f.side !== "SELL" || (f.realized ?? 0) >= -0.005 || round - f.round > PLAYBOOK.coolRounds || (f.stake[agent] ?? 0) <= 0.005) continue;
    out[f.token] = `sold at a loss in round ${f.round}, left alone until round ${f.round + PLAYBOOK.coolRounds + 1}`;
  }
  for (const pos of portfolio.positions) {
    const now = prices[pos.token];
    if (pos.stake[agent] > 0.005 && now !== undefined && now < pos.entryPrice) out[pos.token] = "held at a loss, and a losing position is not added to";
  }
  return out;
}

/**
 * The most an agent may put into a purchase whose stop stands `stopPct` percent below, in whole
 * USDG. What it already holds of `token` counts against it: adding to a position does not
 * add to what the agent may lose on that token.
 */
export function riskStake(portfolio: Portfolio, agent: AgentId, prices: Prices, stopPct: number, token?: AssetKey): number {
  if (!(stopPct > 0)) return 0;
  const atRisk = (agentEquity(portfolio, agent, prices) * PLAYBOOK.riskPct) / 100;
  const held = token ? (positionOf(portfolio, token)?.stake[agent] ?? 0) : 0;
  return Math.max(0, Math.floor(atRisk / (stopPct / 100) - held));
}

/** Whether a position of that size is worth opening at all. */
export const worthOpening = (usd: number) => usd >= MIN_ORDER_USD;

/** How far below its entry a position's stop was set, in percent. */
export const trailOf = (pos: Position): number => pos.trail ?? (pos.entryPrice > 0 && pos.stop < pos.entryPrice ? ((pos.entryPrice - pos.stop) / pos.entryPrice) * 100 : 0);

/**
 * The position as it stands once the price has been seen: its highest price noted, and its
 * stop raised if the price has earned it. Once a position is up by as much as its stop stood
 * below, the stop follows the highest price at that distance, and never stands below the
 * entry again. A stop is only ever raised.
 */
export function follow(pos: Position, price: number): Position {
  const trail = trailOf(pos);
  if (!(price > 0) || !(trail > 0)) return pos;
  const peak = Math.max(pos.peak ?? pos.entryPrice, price);
  const earned = peak >= pos.entryPrice * (1 + trail / 100);
  const stop = earned ? Math.max(pos.stop, pos.entryPrice * (1 + PLAYBOOK.lockPct / 100), peak * (1 - trail / 100)) : pos.stop;
  // A stop that reached the target would close a position the target closes anyway.
  const kept = Math.min(stop, pos.target);
  if (peak === pos.peak && kept === pos.stop && pos.trail !== undefined) return pos;
  return { ...pos, trail, peak, stop: kept };
}

/** Whether the position's stop has been raised above what was paid. Closing at it books a gain. */
export const locked = (pos: Position) => pos.stop > pos.entryPrice;

// --- the skill, as the agents read it ---

const FILE = "skill.md";
const SHARED = "For every agent";

const shared = globalThis as typeof globalThis & { __skill?: { at: number; text: string | null } };
/** The file is read again this often, so that a change to it is picked up without a restart on a developer's machine. */
const REREAD_MS = 60_000;

function read(): string | null {
  const kept = shared.__skill;
  if (kept && Date.now() - kept.at < REREAD_MS) return kept.text;
  let text: string | null = null;
  try {
    const file = path.join(process.cwd(), FILE);
    text = existsSync(file) ? readFileSync(file, "utf8") : null;
  } catch {
    text = null;
  }
  shared.__skill = { at: Date.now(), text };
  return text;
}

/** The part of the skill under a heading of the second level, without the heading. */
export function section(text: string, title: string): string | null {
  const lines = text.split("\n");
  const from = lines.findIndex((l) => l.trim().toLowerCase() === `## ${title}`.toLowerCase());
  if (from < 0) return null;
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => /^##\s/.test(l));
  return (to < 0 ? rest : rest.slice(0, to)).join("\n").trim() || null;
}

/** The rules in a few lines, for when the file can't be read. What the desk enforces is the same either way. */
const inShort = () =>
  [
    `- Buy only a token that is below ${PLAYBOOK.maxRangePos}% of its 24-hour range, with RSI under ${PLAYBOOK.maxRsi}, and where sellers do not lead.`,
    `- Size a purchase so that its stop costs at most ${PLAYBOOK.riskPct}% of what you are worth.`,
    `- Set the target at least ${PLAYBOOK.reward} times as far away as the stop.`,
    `- Do not add to a position that is losing, and leave a token you lost on alone for ${PLAYBOOK.coolRounds} rounds.`,
    "- When no token passes, hold cash and say so.",
  ].join("\n");

/** What an agent is given to read: the rules for every agent, then its own part. */
export function skillFor(agent: AgentId): string {
  const text = read();
  const all = text ? section(text, SHARED) : null;
  const own = text ? section(text, AGENTS[agent].name) : null;
  return [all ?? inShort(), ...(own ? [`Your own part in it, as ${AGENTS[agent].name}:`, own] : [])].join("\n\n");
}
