import { AGENT_ORDER } from "@/lib/agents";
import type { DeskInfo } from "@/lib/chains";
import type { CouncilMode, CouncilSnapshot, RoundResponse } from "@/lib/council-types";
import { deskInfo, settleOnChain } from "../chains/desk";
import { connection } from "../chains/robinhood";
import { councilConfig, type CouncilConfig } from "./config";
import { applyRisk } from "./risk";
import { loadRound } from "./memory";
import { outOfBudget, RoundRun, runRound } from "./round";
import { readState, today, updateState, type CouncilState } from "./store";

// Shared across route bundles, so every viewer follows the same session.
const shared = globalThis as typeof globalThis & { __councilRun?: RoundRun };

function modeOf(cfg: CouncilConfig, state: CouncilState): { mode: CouncilMode; note: string | null } {
  if (!cfg.hasKey) return { mode: "scripted", note: "No AI Gateway key is configured, so the agents are running on scripted rules." };
  if (outOfBudget()) return { mode: "scripted", note: "The AI gateway's budget is used up, so the agents are running on scripted rules until it is raised." };
  const used = state.day === today() ? state.roundsToday : 0;
  if (used >= cfg.maxRoundsPerDay) return { mode: "scripted", note: "Today's AI budget is used up, so the agents are running on scripted rules until tomorrow." };
  return { mode: "live", note: null };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SHOWCASE_HOLDS puts a figure of the owner's choosing in place of what the contracts hold, to show
 * the desk at another size. Each agent's part keeps its share of the real total. The contracts are
 * not touched. It is never shown while the desk takes deposits of real USDG: a funder must see what
 * is really there.
 */
function showcase(desk: DeskInfo | null): DeskInfo | null {
  const figure = round2(Number(process.env.SHOWCASE_HOLDS));
  if (!desk || !desk.holds || !(figure > 0)) return desk;
  if (!connection().testnet && process.env.ALLOW_MAINNET_FUNDING === "true") return desk;
  const scale = figure / desk.holds;
  const agents = { ...desk.agents };
  let left = figure;
  AGENT_ORDER.forEach((a, i) => {
    // The last agent takes what rounding left over, so the parts add up to the figure.
    const part = i === AGENT_ORDER.length - 1 ? left : round2((desk.agents[a].holds ?? 0) * scale);
    left = round2(left - part);
    agents[a] = { ...desk.agents[a], holds: part };
  });
  return { ...desk, agents, holds: figure };
}

export async function snapshot(): Promise<CouncilSnapshot> {
  const cfg = councilConfig();
  const state = await updateState((s) => applyRisk(s).catch(() => s));
  const { mode, note } = modeOf(cfg, state);
  // A stop or target may just have closed a position. The chain catches up in its own time.
  void settleOnChain();
  return {
    desk: showcase(await deskInfo().catch(() => null)),
    mode,
    modeNote: note,
    models: cfg.models,
    round: state.round,
    portfolio: state.portfolio,
    assets: state.assets,
    board: state.board ?? [],
    fills: state.fills,
    nextRoundAt: state.round === 0 ? Date.now() : state.lastRoundAt + cfg.intervalMs,
    intervalMs: cfg.intervalMs,
    serverTime: Date.now(),
  };
}

/** How soon a viewer should ask again while another server is still producing the session. */
const RETRY_MS = 5000;

/**
 * Returns the session a viewer should watch: one they haven't seen, a new one if the
 * next is due, or how long to wait. At most one session is generated per interval,
 * however many viewers or servers ask.
 */
export type Joined = { kind: "run"; run: RoundRun } | ({ kind: "wait" } & RoundResponse);

export async function joinRound(seen: number): Promise<Joined> {
  const cfg = councilConfig();
  const unseen = () => {
    const run = shared.__councilRun;
    if (!run || (run.done && run.failed)) return null;
    return run.id > seen || !run.done ? run : null;
  };

  const watch = (run: RoundRun): Joined => ({ kind: "run", run });
  const wait = (ms: number, nextRoundAt: number): Joined => ({ kind: "wait", wait: ms, nextRoundAt });

  const current = unseen();
  if (current) return watch(current);

  const state = await readState();
  const now = Date.now();
  const next = state.lastRoundAt + cfg.intervalMs;

  // The latest session happened elsewhere, or before a restart. Replay it from storage.
  if (state.round > seen) {
    const stages = await loadRound(state.round).catch(() => null);
    if (stages) return watch((shared.__councilRun = RoundRun.replay(state.round, stages)));
    if (now < next) return wait(Math.min(RETRY_MS, next - now), Math.min(now + RETRY_MS, next));
  }
  if (state.round > 0 && now < next) return wait(next - now, next);

  // Claim the next session. The save only succeeds for one server.
  const claimed = await updateState(async (s) => {
    if (s.round > 0 && now < s.lastRoundAt + cfg.intervalMs) return s;
    const settled = await applyRisk(s, now).catch(() => s);
    const day = today();
    return { ...settled, round: s.round + 1, lastRoundAt: now, day, roundsToday: (settled.day === day ? settled.roundsToday : 0) + 1 };
  });
  if (claimed.lastRoundAt !== now) return wait(RETRY_MS, now + RETRY_MS);

  const run = new RoundRun(claimed.round);
  shared.__councilRun = run;
  void runRound(run, cfg, modeOf(cfg, state).mode, claimed);
  return watch(run);
}
