import { EMOTIONS, type Emotion } from "@/lib/council";
import type { Exchange, Line, Pitch, Pledge, Proposal } from "@/lib/council-types";
import { isToken, type Token } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import type { RoundCtx } from "./context";

export type PitchOut = Omit<Pitch, "agent" | "source"> & { sellPct: number };
export type SayOut = { emotion: Emotion; say: string };
export type ReplyOut = SayOut & { stopPct: number; targetPct: number };
export type PledgeOut = SayOut & { support: boolean; stakeUsd: number; reason: string };

export interface ClosingInput {
  pledges: Pledge[];
  approved: boolean;
  yes: number;
  totalUsd: number;
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
export const asToken = (v: unknown, fallback: Token): Token => {
  const t = String(v ?? "").toUpperCase();
  return isToken(t) ? t : fallback;
};

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
  if (p.action === "SELL" && !ctx.sellable.includes(p.token)) p.action = "HOLD";
  if (p.action === "BUY") {
    p.stakeUsd = Math.floor(clamp(p.stakeUsd, 0, cash));
    if (p.stakeUsd < 5) p.action = "HOLD";
  }
  if (p.action !== "BUY") p.stakeUsd = 0;
  return p;
}
