import type { ModelInfo } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";

const DEFAULT_MODELS: Record<AgentId, string> = {
  quant: "openai/gpt-6-astra",
  guardian: "anthropic/claude-opus-4.5",
  degen: "google/gemini-2.5-pro",
  oracle: "typesafe-ai/jev",
};

const NAMES: Record<string, string> = {
  "openai/gpt-6-astra": "GPT-6 Astra",
  "anthropic/claude-opus-4": "Claude Opus 4",
  "anthropic/claude-opus-4.5": "Claude Opus 4.5",
  "anthropic/claude-opus-4.8": "Claude Opus 4.8",
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
}

export function councilConfig(): CouncilConfig {
  const env = process.env;
  const modelIds: Record<AgentId, string> = {
    quant: env.COUNCIL_MODEL_QUANT || DEFAULT_MODELS.quant,
    guardian: env.COUNCIL_MODEL_GUARDIAN || DEFAULT_MODELS.guardian,
    degen: env.COUNCIL_MODEL_DEGEN || DEFAULT_MODELS.degen,
    oracle: env.COUNCIL_MODEL_ORACLE || DEFAULT_MODELS.oracle,
  };
  const info = (a: AgentId): ModelInfo => ({ id: modelIds[a], name: NAMES[modelIds[a]] ?? prettify(modelIds[a]) });

  return {
    hasKey: !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN),
    modelIds,
    models: { quant: info("quant"), guardian: info("guardian"), degen: info("degen"), oracle: info("oracle") },
    intervalMs: Math.max(num(env.COUNCIL_INTERVAL_SECONDS, 300), 60) * 1000,
    maxRoundsPerDay: num(env.COUNCIL_MAX_ROUNDS_PER_DAY, 100),
    callTimeoutMs: num(env.COUNCIL_CALL_TIMEOUT_SECONDS, 45) * 1000,
  };
}

/** Evaluation models answer typed questions instead of writing text. */
export const isEvaluationModel = (id: string) => id.startsWith("typesafe-ai/");
