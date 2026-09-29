import type { ModelInfo } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";

const DEFAULT_MODELS: Record<AgentId, string> = {
  quant: "openai/gpt-5.6-sol",
  guardian: "anthropic/claude-opus-5.5",
  degen: "alibaba/qwen3.8-max",
  oracle: "typesafe-ai/jev",
};

const NAMES: Record<string, string> = {
  "openai/gpt-6-astra": "GPT-6 Astra",
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
  modelIds: Record<AgentId, string>;
  models: Record<AgentId, ModelInfo>;
  intervalMs: number;
  maxRoundsPerDay: number;
  callTimeoutMs: number;
  /**
   * Agents that are given Jev's odds to weigh before they decide. The model still makes the
   * decision and writes what the agent says. Jev's odds are one more reading on its desk.
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
  const oddsModel = env.COUNCIL_ODDS_MODEL || DEFAULT_MODELS.oracle;
  const asked = (env.COUNCIL_ODDS_FOR ?? "degen").split(",").map((a) => a.trim());
  // An agent that is an evaluation model itself has odds of its own.
  const withOdds = (Object.keys(modelIds) as AgentId[]).filter((a) => asked.includes(a) && !isEvaluationModel(modelIds[a]));
  const nameOf = (id: string) => NAMES[id] ?? prettify(id);
  // The name says so when a second model has a part in the agent's decisions.
  const info = (a: AgentId): ModelInfo => ({ id: modelIds[a], name: withOdds.includes(a) ? `${nameOf(modelIds[a])} + ${nameOf(oddsModel)}` : nameOf(modelIds[a]) });

  return {
    hasKey: !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN),
    modelIds,
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
