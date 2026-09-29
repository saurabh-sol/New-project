import { EMOTIONS, MIN_ORDER_USD, type Emotion } from "@/lib/council";
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
  yes: number;
  totalUsd: number;
  /** The trade goes ahead on the leader's commitment to a funder, without the votes to pass. */
  alone: boolean;
}

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

export const STOP_RANGE = [2, 10] as const;
export const TARGET_RANGE = [3, 20] as const;

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

/** Whether this agent is the one presenting a funder's request this round. */
export const presents = (agent: AgentId, ctx: RoundCtx) => ctx.request?.agent === agent;

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
  if (p.action === "SELL" && !ctx.sellable.includes(p.token)) p.action = "HOLD";
  if (p.action === "BUY") {
    p.stakeUsd = Math.floor(clamp(p.stakeUsd, 0, cash));
    if (p.stakeUsd < 5) p.action = "HOLD";
  }
  if (p.action !== "BUY") p.stakeUsd = 0;
  return p;
}
