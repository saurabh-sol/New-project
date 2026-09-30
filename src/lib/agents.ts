import type { AgentId, AgentProfile } from "./types";

/**
 * The four agents. The keys are what the desk has called them since the start, and are what the
 * database, the contracts' settings and the code know them by. `name` is what people see.
 */
export const AGENTS: Record<AgentId, AgentProfile> = {
  quant: {
    id: "quant",
    name: "The Researcher",
    role: "Momentum & technicals",
    model: "GPT-6 Astra",
    provider: "OpenAI",
    color: "#f4f4f5",
    body: "#fafafa",
    bodyShade: "#a1a1aa",
    head: "#ffffff",
    headShade: "#c9c9d1",
    persona: "Data-driven. Trusts indicators over narratives.",
  },
  degen: {
    id: "degen",
    name: "The Observer",
    role: "Momentum & conviction",
    model: "Grok 4.7",
    provider: "SpaceXAI",
    color: "#38bdf8",
    body: "#334155",
    bodyShade: "#0f172a",
    head: "#475569",
    headShade: "#1e293b",
    persona: "Follows the strongest movers. High conviction, clear sizing.",
  },
  guardian: {
    id: "guardian",
    name: "The Strategist",
    role: "Risk manager",
    model: "Claude Opus 5.5",
    provider: "Anthropic",
    color: "#fbbf24",
    body: "#ea8a2e",
    bodyShade: "#b45309",
    head: "#fbeedb",
    headShade: "#dcb98a",
    persona: "Sizes every position. Holds the veto.",
  },
  oracle: {
    id: "oracle",
    name: "The Executor",
    role: "Probabilities & odds",
    model: "Jev",
    provider: "TypeSafe AI",
    color: "#f472b6",
    body: "#ec4899",
    bodyShade: "#be185d",
    head: "#fdf2f8",
    headShade: "#efb4d3",
    persona: "Speaks only in probabilities. Never trades a coin flip.",
  },
};

export const AGENT_ORDER: AgentId[] = ["quant", "degen", "guardian", "oracle"];

/** The agents as a trade lists them: the one that led it first, then the others in their usual order. */
export const leaderFirst = (leader: AgentId): AgentId[] => [leader, ...AGENT_ORDER.filter((a) => a !== leader)];

/** What the agents were called before they were renamed. Older sessions on record still use these names. */
const FORMER: Record<string, AgentId> = { Quant: "quant", Degen: "degen", Guardian: "guardian", Oracle: "oracle" };

/** A line from the desk's record, with every agent called by its present name. */
export const withPresentNames = (text: string) => text.replace(/\b(Quant|Degen|Guardian|Oracle)\b/g, (old) => AGENTS[FORMER[old]].name.replace("The ", ""));
