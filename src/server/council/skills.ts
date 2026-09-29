/**
 * What keeps the agents from saying the same thing every session.
 *
 * A model can't be retrained from here. What can be controlled is what it is given:
 * a different analytical focus each round, its own recent lines to avoid, and a
 * check that rejects a draft too close to something it already said.
 */
import { AGENT_ORDER } from "@/lib/agents";
import type { AgentId } from "@/lib/types";

export interface Skill {
  id: string;
  name: string;
  /** What to look at, in terms of the market table the agent receives. */
  brief: string;
}

export const SKILLS: Record<AgentId, Skill[]> = {
  quant: [
    { id: "momentum", name: "Momentum across timeframes", brief: "Compare the 15m, 1h and 4h changes. Is momentum building, fading or reversing?" },
    { id: "trend", name: "Trend alignment", brief: "Does the trend reading agree with the 1h and 4h moves, or is price moving against its trend?" },
    { id: "meanrev", name: "Overbought and oversold", brief: "Look at RSI extremes together with where price sits in its 24h range." },
    { id: "volume", name: "Volume confirmation", brief: "Is the latest move backed by above-average volume, or is it drifting on thin volume?" },
    { id: "relative", name: "Relative strength", brief: "Which Stock Token is beating or lagging the stock market over the last hour, and is that gap widening?" },
  ],
  guardian: [
    { id: "sizing", name: "Position sizing", brief: "How much of the pool is already at risk, and how large can a new position sensibly be?" },
    { id: "stops", name: "Stop distance against volatility", brief: "Compare the stop distance with the token's volatility per 5 minutes. Would normal noise hit the stop?" },
    { id: "payoff", name: "Risk against reward", brief: "Weigh the distance to target against the distance to stop, and where price sits in its range." },
    { id: "concentration", name: "Concentration", brief: "Would this trade pile more risk onto a token or a move the desk is already exposed to?" },
    { id: "liquidity", name: "Liquidity", brief: "Thin volume makes entries and exits worse. Is there enough volume behind the token?" },
  ],
  degen: [
    { id: "leader", name: "Strongest mover", brief: "Find the token leading on the 1h and 4h changes and judge whether it still has room in its 24h range." },
    { id: "breakout", name: "Breakout watch", brief: "Is price pressing the top of its 1h range with volume expanding?" },
    { id: "expansion", name: "Volume expansion", brief: "Where is volume rising fastest against its average, and which way is price going with it?" },
    { id: "laggard", name: "Catch-up candidates", brief: "Which token has lagged over the last hour and is now turning up on the 15m change?" },
    { id: "exhaustion", name: "Exhaustion check", brief: "Is the leading move stretched: high RSI, top of its range, momentum fading on 15m?" },
  ],
  oracle: [
    { id: "hour", name: "One-hour odds", brief: "The probability that each token trades higher one hour from now." },
    { id: "breakout", name: "Breakout odds", brief: "The probability that each token trades above its 1-hour high within the next hour." },
    { id: "four", name: "Four-hour odds", brief: "The probability that each token trades higher four hours from now." },
  ],
};

/** The skill this agent has gone longest without using. */
export function pickLens(agent: AgentId, history: string[]): Skill {
  const skills = SKILLS[agent];
  const lastUsed = (id: string) => history.lastIndexOf(id);
  return [...skills].sort((a, b) => lastUsed(a.id) - lastUsed(b.id))[0];
}

const STOP_WORDS = new Set(["the", "a", "an", "and", "or", "but", "is", "are", "to", "of", "in", "on", "at", "with", "that", "this", "it", "i", "we", "for", "so", "as", "its"]);

function phrases(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const out = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

/** Share of two-word phrases two lines have in common, 0 to 1. Numbers are ignored, since they change every round. */
export function similarity(a: string, b: string): number {
  const pa = phrases(a);
  const pb = phrases(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  let both = 0;
  for (const p of pa) if (pb.has(p)) both++;
  return both / Math.min(pa.size, pb.size);
}

const TOO_CLOSE = 0.45;

/** The earlier line this draft repeats, if any. */
export function repeats(draft: string, earlier: string[]): string | null {
  return earlier.find((line) => similarity(draft, line) >= TOO_CLOSE) ?? null;
}

/**
 * Of several ways to say the same thing, the one least like what was said before.
 * `turn` decides which comes first when several are equally fresh. Agents who speak at the
 * same moment pass different turns, so they don't all land on the same sentence.
 */
export function freshest(variants: string[], earlier: string[], turn = 0): string {
  const worst = (v: string) => Math.max(0, ...earlier.map((e) => similarity(v, e)));
  const start = turn % variants.length;
  return [...variants.slice(start), ...variants.slice(0, start)].sort((a, b) => worst(a) - worst(b))[0];
}

/**
 * Chooses how an agent words a stock remark: unlike what it said before, and unlike what
 * anyone else has said in this session. The choice is noted at once, so agents who speak
 * at the same moment don't land on the same sentence.
 */
export function pick(variants: string[], ctx: { said: Record<AgentId, string[]>; floor: string[] }, agent: AgentId): string {
  const line = freshest(variants, [...ctx.said[agent], ...ctx.floor], AGENT_ORDER.indexOf(agent));
  ctx.floor.push(line);
  return line;
}

/**
 * How hard an agent is allowed to think, set by how much users have funded it.
 * Deeper thinking costs more per session, and funding fees are what pay for it.
 * It buys more analysis, not a better result.
 */
export type Effort = "low" | "medium" | "high";

export const FUNDING_LEVELS = [
  { level: 1, from: 0, effort: "low" as Effort, label: "Standard analysis" },
  { level: 2, from: 50, effort: "medium" as Effort, label: "Extended analysis" },
  { level: 3, from: 250, effort: "high" as Effort, label: "Deep analysis" },
];

export const fundingLevel = (fundedUsd: number) => [...FUNDING_LEVELS].reverse().find((l) => fundedUsd >= l.from) ?? FUNDING_LEVELS[0];
