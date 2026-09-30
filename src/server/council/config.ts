import type { ModelInfo } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";

const DEFAULT_MODELS: Record<AgentId, string> = {
  quant: "openai/gpt-6-astra",
  guardian: "anthropic/claude-opus-5.5",
  degen: "alibaba/qwen3.8-max",
  oracle: "typesafe-ai/jev",
};

/**
 * Agents whose decisions are made by the evaluation model, unless a setting says otherwise.
 * Their own model, the one they are shown with, puts each decision into words.
 */
const DEFAULT_BRAINS: Partial<Record<AgentId, string>> = {
  quant: "typesafe-ai/jev",
  degen: "typesafe-ai/jev",
};

const NAMES: Record<string, string> = {
  "openai/gpt-6-astra": "GPT-6 Astra",
  "openai/gpt-6-sol": "GPT-6 Sol",
  "openai/gpt-5.6-sol": "GPT-5.6 Sol",
  "spacexai/grok-4.6": "Grok 4.6",
  "alibaba/qwen3.8-max": "Qwen 3.8 Max",
  "anthropic/claude-opus-4": "Claude Opus 4",
  "anthropic/claude-opus-4.5": "Claude Opus 4.5",
  "anthropic/claude-opus-4.8": "Claude Opus 4.8",
  "anthropic/claude-opus-5.5": "Claude Opus 5.5",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "spacexai/grok-4.7": "Grok 4.7",
  "typesafe-ai/jev": "Jev",
};

/** "google/gemini-3.8-flash" -> "Gemini 3.8 Flash" */
const prettify = (id: string) =>
  (id.split("/")[1] ?? id)
    .split("-")
    .map((w) => (/^gpt$/i.test(w) ? "GPT" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

export interface CouncilConfig {
  hasKey: boolean;
  /** The model each agent speaks with, and is shown with on the site. */
  modelIds: Record<AgentId, string>;
  /**
   * The model that makes each agent's decisions. For most it is the agent's own model. Where it is
   * an evaluation model and the agent's own model writes text, the evaluation model decides what
   * to trade, how much and how to vote, and the agent's own model says it.
   */
  brainIds: Record<AgentId, string>;
  models: Record<AgentId, ModelInfo>;
  intervalMs: number;
  maxRoundsPerDay: number;
  callTimeoutMs: number;
  /**
   * Agents that decide with their own model and are given Jev's odds to weigh before they do.
   * Jev's odds are one more reading on their desk.
   */
  withOdds: AgentId[];
  /** The evaluation model that gives those odds. */
  oddsModel: string;
}

export function councilConfig(): CouncilConfig {
  const env = process.env;
  const modelIds: Record<AgentId, string> = {
    quant: env.COUNCIL_MODEL_QUANT || DEFAULT_MODELS.quant,
    guardian: env.COUNCIL_MODEL_GUARDIAN || DEFAULT_MODELS.guardian,
    degen: env.COUNCIL_MODEL_DEGEN || DEFAULT_MODELS.degen,
    oracle: env.COUNCIL_MODEL_ORACLE || DEFAULT_MODELS.oracle,
  };
  const brainIds: Record<AgentId, string> = {
    quant: env.COUNCIL_BRAIN_QUANT || DEFAULT_BRAINS.quant || modelIds.quant,
    guardian: env.COUNCIL_BRAIN_GUARDIAN || DEFAULT_BRAINS.guardian || modelIds.guardian,
    degen: env.COUNCIL_BRAIN_DEGEN || DEFAULT_BRAINS.degen || modelIds.degen,
    oracle: env.COUNCIL_BRAIN_ORACLE || DEFAULT_BRAINS.oracle || modelIds.oracle,
  };
  const oddsModel = env.COUNCIL_ODDS_MODEL || DEFAULT_MODELS.oracle;
  const asked = (env.COUNCIL_ODDS_FOR ?? "").split(",").map((a) => a.trim());
  // An agent whose brain is an evaluation model has odds of its own.
  const withOdds = (Object.keys(modelIds) as AgentId[]).filter((a) => asked.includes(a) && !isEvaluationModel(brainIds[a]));
  const nameOf = (id: string) => NAMES[id] ?? prettify(id);
  const info = (a: AgentId): ModelInfo => ({ id: modelIds[a], name: nameOf(modelIds[a]) });

  return {
    hasKey: !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN),
    modelIds,
    brainIds,
    models: { quant: info("quant"), guardian: info("guardian"), degen: info("degen"), oracle: info("oracle") },
    intervalMs: Math.max(num(env.COUNCIL_INTERVAL_SECONDS, 300), 60) * 1000,
    maxRoundsPerDay: num(env.COUNCIL_MAX_ROUNDS_PER_DAY, 100),
    callTimeoutMs: num(env.COUNCIL_CALL_TIMEOUT_SECONDS, 45) * 1000,
    withOdds,
    oddsModel,
  };
}

/**
 * How hard a model is asked to think, in a word it knows. The desk speaks of low, medium and
 * high. Qwen has no "high", and answers nothing at all when asked for it, so it is asked for
 * "medium". Mistral takes no such setting.
 */
export function effortFor(model: string, effort: "low" | "medium" | "high"): "low" | "medium" | "high" | undefined {
  if (model.startsWith("mistral/")) return undefined;
  if (model.startsWith("alibaba/") && effort === "high") return "medium";
  return effort;
}

/** Evaluation models answer typed questions instead of writing text. */
export const isEvaluationModel = (id: string) => id.startsWith("typesafe-ai/");
