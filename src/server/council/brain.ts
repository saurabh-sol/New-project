import { EMOTIONS, MIN_ORDER_USD, OWN_BOOK_SHARE, STARTER_USD, type Emotion } from "@/lib/council";
import type { Exchange, Line, Pitch, Pledge, Proposal } from "@/lib/council-types";
import type { AssetKey } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import type { RoundCtx } from "./context";

export type PitchOut = Omit<Pitch, "agent" | "source"> & { sellPct: number };
export type SayOut = { emotion: Emotion; say: string };
export type ReplyOut = SayOut & { stopPct: number; targetPct: number };
export type PledgeOut = SayOut & { support: boolean; stakeUsd: number; reason: string };

export interface ClosingInput {
  pledges: Pledge[];
  /** Whether the trade goes ahead. */
  approved: boolean;
  /** Traders behind the trade, the leader included. */
  yes: number;
  totalUsd: number;
  /** The leader is bound to the trade by a funder's request, so nobody voted on whether to trade: the others only joined or stayed out. */
  committed: boolean;
  /** The council did not back the proposal, so the leader trades it alone, for its own book. */
  alone: boolean;
}

/** Who put cash in beside the leader, as "The Quant ($10)", or "nobody". */
export const backers = (pledges: Pledge[], name: (a: AgentId) => string) =>
  pledges
    .filter((p) => p.support && p.stakeUsd > 0)
    .map((p) => `${name(p.agent)} ($${p.stakeUsd})`)
    .join(", ") || "nobody";

/** How one agent thinks. Implemented by language models, the evaluation model, and a scripted stand-in. */
export interface Brain {
  pitch(agent: AgentId, ctx: RoundCtx): Promise<PitchOut>;
  /** `debate` holds the exchanges that already happened this round. */
  challenge(agent: AgentId, ctx: RoundCtx, proposal: Proposal, pitches: Pitch[], debate: Exchange[]): Promise<SayOut>;
  reply(agent: AgentId, ctx: RoundCtx, proposal: Proposal, challenge: Line, debate: Exchange[]): Promise<ReplyOut>;
  pledge(agent: AgentId, ctx: RoundCtx, proposal: Proposal, pitches: Pitch[], debate: Exchange[]): Promise<PledgeOut>;
  closing(agent: AgentId, ctx: RoundCtx, proposal: Proposal, input: ClosingInput): Promise<SayOut>;
}

export const clamp = (n: number, lo: number, hi: number) => (isFinite(n) ? Math.min(Math.max(n, lo), hi) : lo);

// The desk trades young tokens that move several percent in minutes, so its stops and targets are wide.
export const STOP_RANGE = [3, 25] as const;
export const TARGET_RANGE = [5, 60] as const;

/** A stop must stand at least this many times the token's usual 5-minute move away, or noise alone sets it off. */
const STOP_CLEARANCE = 1.5;

/**
 * The stop and target the desk will accept for a purchase of a token that usually moves
 * `atrPct` percent in five minutes: the stop clear of the noise, the target no nearer than the stop.
 */
export function fitTerms(stopPct: number, targetPct: number, atrPct: number): { stopPct: number; targetPct: number } {
  const floor = Math.ceil(clamp(atrPct * STOP_CLEARANCE, ...STOP_RANGE) * 2) / 2;
  const stop = Math.max(clamp(stopPct, ...STOP_RANGE), floor);
  return { stopPct: stop, targetPct: Math.max(clamp(targetPct, ...TARGET_RANGE), stop) };
}

/** Desk talk is short. Anything longer is cut at the last full sentence that fits. */
const MAX_SAY = 120;

/** Makes model text safe to show in a speech bubble: one line, no markdown, bounded length. */
export function cleanSay(text: unknown): string {
  const s = String(text ?? "")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= MAX_SAY) return s;
  const cut = s.slice(0, MAX_SAY);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return stop > 40 ? cut.slice(0, stop + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

export const asEmotion = (v: unknown): Emotion => ((EMOTIONS as readonly string[]).includes(String(v)) ? (v as Emotion) : "neutral");
/** The token the model named, if it is one the desk is looking at this round. Otherwise the first on the board. */
export const asToken = (v: unknown, ctx: RoundCtx): AssetKey => {
  const t = String(v ?? "").trim().toUpperCase();
  return ctx.stats.find((s) => s.token.toUpperCase() === t)?.token ?? ctx.stats[0].token;
};

/** The most an agent may put behind its own pitch this round. */
export const mostStake = (ctx: RoundCtx, agent: AgentId) => Math.floor(ctx.portfolio.cash[agent] * OWN_BOOK_SHARE);

/** The smallest position an agent with none may open. Less, if it has less. */
export const starterStake = (ctx: RoundCtx, agent: AgentId) => Math.min(STARTER_USD, mostStake(ctx, agent));

/** Tokens that can be bought this round. */
export const openTokens = (ctx: RoundCtx) => ctx.stats.map((s) => s.token).filter((t) => !ctx.closed.includes(t) && !ctx.sellOnly.includes(t));

/** Tokens this agent may pitch a sale of: its own, and those the council may sell. */
export const saleTokens = (ctx: RoundCtx, agent: AgentId) => [...new Set([...ctx.mine[agent], ...ctx.sellable])];

/** Tokens for a starter position: those no colleague has picked this round, or any open one if all are picked. */
export function starterTokens(ctx: RoundCtx): AssetKey[] {
  const open = openTokens(ctx);
  const free = open.filter((t) => !ctx.taken.includes(t));
  return free.length ? free : open;
}

/** Whether this agent is the one presenting a funder's request this round. */
export const presents = (agent: AgentId, ctx: RoundCtx) => ctx.request?.agent === agent;

/** Whether this agent is giving its view of a funder's request that another agent presents. */
export const weighs = (agent: AgentId, ctx: RoundCtx) => !!ctx.request && ctx.request.agent !== agent;

/**
 * The cash an agent puts behind a funder's request. Committed, it is the funding that came
 * with the request. Suggested, it is what the agent chose, but never less than that funding
 * or the desk's smallest order.
 */
export function requestStake(ctx: RoundCtx, agent: AgentId, chosen: number): number {
  const r = ctx.request!;
  const cash = ctx.portfolio.cash[agent];
  const floor = Math.max(r.usd, MIN_ORDER_USD);
  return Math.floor(Math.min(cash, r.mode === "commit" ? floor : Math.max(chosen, floor)));
}

/**
 * Forces a pitch to obey the desk's rules, whatever the model asked for:
 * no selling what isn't held (or is too new), no staking more than the agent's cash.
 */
export function enforcePitch(agent: AgentId, ctx: RoundCtx, out: PitchOut): PitchOut {
  const cash = ctx.portfolio.cash[agent];
  const p: PitchOut = {
    ...out,
    conviction: Math.round(clamp(out.conviction, 1, 5)),
    stopPct: clamp(out.stopPct, ...STOP_RANGE),
    targetPct: clamp(out.targetPct, ...TARGET_RANGE),
    sellPct: out.sellPct >= 75 ? 100 : 50,
    say: cleanSay(out.say),
  };
  // A funder's request is always presented as a purchase of the token asked for.
  if (presents(agent, ctx)) return { ...p, action: "BUY", token: ctx.request!.asset.key, stakeUsd: requestStake(ctx, agent, out.stakeUsd), sellPct: 100 };
  // When a request is on the floor the whole desk speaks to it: BUY means "I would join", HOLD means "I would not".
  if (weighs(agent, ctx)) {
    p.token = ctx.request!.asset.key;
    if (p.action === "SELL") p.action = "HOLD";
  }
  if (p.action !== "HOLD" && ctx.closed.includes(p.token)) p.action = "HOLD";
  if (p.action === "BUY" && ctx.sellOnly.includes(p.token) && !presents(agent, ctx) && !weighs(agent, ctx)) p.action = "HOLD";
  if (p.action === "SELL" && !saleTokens(ctx, agent).includes(p.token)) p.action = "HOLD";
  // An agent with no position opens one. If it named a token that can be bought, that is the one.
  if (ctx.mustTrade[agent] && p.action !== "BUY") {
    const open = starterTokens(ctx);
    if (open.length && starterStake(ctx, agent) >= MIN_ORDER_USD) {
      p.action = "BUY";
      p.token = open.includes(p.token) ? p.token : open[0];
      p.stakeUsd = starterStake(ctx, agent);
      p.say = cleanSay(`Desk rule: I hold nothing, so I open a starter. $${p.stakeUsd} of ${p.token}.`);
    }
  }
  if (p.action === "BUY") {
    const most = weighs(agent, ctx) ? cash : mostStake(ctx, agent);
    p.stakeUsd = Math.floor(clamp(p.stakeUsd, ctx.mustTrade[agent] ? starterStake(ctx, agent) : 0, most));
    if (p.stakeUsd < 5) p.action = "HOLD";
  }
  if (p.action !== "BUY") p.stakeUsd = 0;
  return p;
}
