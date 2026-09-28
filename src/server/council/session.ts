import type { CouncilMode, CouncilSnapshot, RoundResponse } from "@/lib/council-types";
import { councilConfig, type CouncilConfig } from "./config";
import { applyRisk } from "./risk";
import { RoundRun, runRound } from "./round";
import { readState, today, updateState, type CouncilState } from "./store";

// Shared across route bundles, so every viewer follows the same session.
const shared = globalThis as typeof globalThis & { __councilRun?: RoundRun };

function modeOf(cfg: CouncilConfig, state: CouncilState): { mode: CouncilMode; note: string | null } {
  if (!cfg.hasKey) return { mode: "scripted", note: "No AI Gateway key is configured, so the agents are running on scripted rules." };
  const used = state.day === today() ? state.roundsToday : 0;
  if (used >= cfg.maxRoundsPerDay) return { mode: "scripted", note: "Today's AI budget is used up, so the agents are running on scripted rules until tomorrow." };
  return { mode: "live", note: null };
}

export async function snapshot(): Promise<CouncilSnapshot> {
  const cfg = councilConfig();
  const state = await updateState((s) => applyRisk(s).catch(() => s));
  const { mode, note } = modeOf(cfg, state);
  return {
    mode,
    modeNote: note,
    models: cfg.models,
    round: state.round,
    portfolio: state.portfolio,
    fills: state.fills,
    nextRoundAt: state.round === 0 ? Date.now() : state.lastRoundAt + cfg.intervalMs,
    intervalMs: cfg.intervalMs,
    serverTime: Date.now(),
  };
}

/**
 * Returns the session a viewer should watch: the one in memory if they haven't seen
 * it, a new one if the next is due, or how long to wait. At most one session is
 * generated per interval, however many viewers ask.
 */
export async function joinRound(seen: number): Promise<RoundRun | RoundResponse> {
  const cfg = councilConfig();
  const unseen = () => {
    const run = shared.__councilRun;
    if (!run || (run.done && run.failed)) return null;
    return run.id > seen || !run.done ? run : null;
  };

  const current = unseen();
  if (current) return current;

  const state = await readState();
  const now = Date.now();
  const next = state.lastRoundAt + cfg.intervalMs;
  if (state.round > 0 && now < next) return { wait: next - now, nextRoundAt: next };

  // Nothing between this check and the assignment below can yield, so only one request starts a round.
  const started = unseen();
  if (started) return started;
  const run = new RoundRun(state.round + 1);
  shared.__councilRun = run;
  void runRound(run, cfg, modeOf(cfg, state).mode);
  return run;
}
