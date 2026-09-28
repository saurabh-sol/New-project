/**
 * Runs one council session: pitches, debate, pledges, vote, order.
 * The models supply opinions; this file decides what is allowed to happen.
 */
import { AGENT_ORDER } from "@/lib/agents";
import { buy, canSell, fitStakes, sell, zeroStakes, type Fill, type Portfolio } from "@/lib/council";
import type { CouncilMode, Exchange, Line, Pitch, Pledge, Proposal, Source, Stage, TokenStats, Vote } from "@/lib/council-types";
import type { Token } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { clamp, enforcePitch, STOP_RANGE, TARGET_RANGE, type Brain } from "./brain";
import { isEvaluationModel, type CouncilConfig } from "./config";
import { nameOf, px, signed, usd, type RoundCtx } from "./context";
import { jevBrain } from "./jev-brain";
import { llmBrain } from "./llm-brain";
import { applyRisk } from "./risk";
import { scriptedBrain } from "./scripted-brain";
import { fetchPrice, fetchStats } from "./stats";
import { today, updateState } from "./store";

const VOTES_TO_PASS = 3;

/** A session in progress. Any number of viewers can follow the same one. */
export class RoundRun {
  readonly stages: Stage[] = [];
  done = false;
  /** Set when the round broke before finishing, so it is not replayed to later viewers. */
  failed = false;
  private waiting: Array<() => void> = [];

  constructor(readonly id: number) {}

  push(stage: Stage) {
    this.stages.push(stage);
    this.wake();
  }

  finish() {
    this.done = true;
    this.wake();
  }

  private wake() {
    for (const w of this.waiting.splice(0)) w();
  }

  /** Every stage so far, then each new one as it is produced. */
  async *follow(): AsyncGenerator<Stage> {
    let i = 0;
    for (;;) {
      while (i < this.stages.length) yield this.stages[i++];
      if (this.done) return;
      await new Promise<void>((r) => this.waiting.push(r));
    }
  }
}

type Tagged<T> = T & { source: Source };

/** Runs a call on the agent's model and falls back to the scripted stand-in if it fails. */
function thinker(cfg: CouncilConfig, mode: CouncilMode) {
  const scripted = scriptedBrain();
  const llm = llmBrain(cfg);
  const jev = jevBrain(cfg);
  const modelFor = (agent: AgentId): Brain => (isEvaluationModel(cfg.modelIds[agent]) ? jev : llm);

  return async function think<T extends object>(agent: AgentId, call: (brain: Brain) => Promise<T>): Promise<Tagged<T>> {
    if (mode === "live") {
      try {
        return { ...(await call(modelFor(agent))), source: "model" };
      } catch (e) {
        console.error(`[council] ${cfg.modelIds[agent]} failed for ${agent}, using scripted stand-in:`, e instanceof Error ? e.message : e);
      }
    }
    return { ...(await call(scripted)), source: "scripted" };
  };
}

/** The strongest non-HOLD pitch becomes the proposal the council debates. */
function chooseProposal(pitches: Pitch[], sellPct: Record<AgentId, number>): Proposal | null {
  const lead = pitches
    .filter((p) => p.action !== "HOLD")
    .sort((a, b) => b.conviction - a.conviction || b.stakeUsd - a.stakeUsd)[0];
  if (!lead || lead.action === "HOLD") return null;
  return { leader: lead.agent, action: lead.action, token: lead.token, stopPct: lead.stopPct, targetPct: lead.targetPct, sellPct: sellPct[lead.agent] };
}

/** Two agents walk over to question the leader: those who disagree most, then the risk manager. */
function chooseChallengers(pitches: Pitch[], proposal: Proposal): AgentId[] {
  const others = pitches.filter((p) => p.agent !== proposal.leader);
  const disagrees = (p: Pitch) => p.action !== proposal.action || p.token !== proposal.token;
  const ranked = [
    ...others.filter(disagrees).sort((a, b) => b.conviction - a.conviction),
    ...others.filter((p) => !disagrees(p)).sort((a, b) => (a.agent === "guardian" ? -1 : b.agent === "guardian" ? 1 : 0)),
  ];
  return ranked.slice(0, 2).map((p) => p.agent);
}

/** Where a round gets its market data. Replaceable so a round can be tested against a chosen market. */
export interface MarketSource {
  stats(): Promise<TokenStats[]>;
  price(token: Token): Promise<number>;
}

const liveMarket: MarketSource = { stats: fetchStats, price: fetchPrice };

export async function runRound(run: RoundRun, cfg: CouncilConfig, mode: CouncilMode, market: MarketSource = liveMarket): Promise<void> {
  try {
    const startedAt = Date.now();
    const stats = await market.stats();
    if (stats.length === 0) throw new Error("No market data available");
    const prices = Object.fromEntries(stats.map((s) => [s.token, s.price])) as Partial<Record<Token, number>>;

    // Claim the round up front so the next one can't start while this one is running.
    const opening = await updateState(async (s) => {
      const settled = await applyRisk(s, startedAt).catch(() => s);
      const day = today();
      return { ...settled, round: run.id, lastRoundAt: startedAt, day, roundsToday: (settled.day === day ? settled.roundsToday : 0) + 1 };
    });
    const before = opening.portfolio;

    const ctx: RoundCtx = {
      round: run.id,
      stats,
      portfolio: before,
      prices,
      sellable: before.positions.filter((p) => canSell(before, p.token, run.id)).map((p) => p.token),
      recent: opening.recent,
    };
    run.push({ stage: "open", round: run.id, mode, stats, portfolio: before, startedAt });

    const think = thinker(cfg, mode);
    const sellPct = { quant: 100, degen: 100, guardian: 100, oracle: 100 } as Record<AgentId, number>;

    // 1. Pitches
    const pitches: Pitch[] = await Promise.all(
      AGENT_ORDER.map(async (agent) => {
        const raw = await think(agent, (b) => b.pitch(agent, ctx));
        const p = enforcePitch(agent, ctx, raw);
        sellPct[agent] = p.sellPct;
        return { agent, action: p.action, token: p.token, stakeUsd: p.stakeUsd, stopPct: p.stopPct, targetPct: p.targetPct, conviction: p.conviction, emotion: p.emotion, say: p.say, source: raw.source };
      }),
    );
    let proposal = chooseProposal(pitches, sellPct);
    run.push({ stage: "pitches", pitches, proposal });

    if (!proposal) {
      const note = "The council holds. No agent proposed a trade this round.";
      await updateState((s) => ({ ...s, recent: [...s.recent, `Round ${run.id}: every agent chose to hold. No trade.`] }));
      run.push({ stage: "outcome", fill: null, portfolio: before, note });
      return;
    }
    const leader = proposal.leader;
    const first = proposal;

    // 2. Debate at the leader's desk. One challenger at a time, so the leader's answers build on each other.
    const exchanges: Exchange[] = [];
    let terms = first;
    for (const agent of chooseChallengers(pitches, first)) {
      const current = terms;
      const soFar = [...exchanges];
      const c = await think(agent, (b) => b.challenge(agent, ctx, current, pitches, soFar));
      const challenge: Line = { agent, to: leader, emotion: c.emotion, say: c.say, source: c.source };
      const r = await think(leader, (b) => b.reply(leader, ctx, current, challenge, soFar));
      terms = { ...current, stopPct: clamp(r.stopPct, ...STOP_RANGE), targetPct: clamp(r.targetPct, ...TARGET_RANGE) };
      exchanges.push({ challenge, reply: { agent: leader, to: agent, emotion: r.emotion, say: r.say, source: r.source } });
    }
    proposal = terms;
    const final = proposal;
    run.push({ stage: "debate", exchanges });

    // 3. Pledges. A vote is whatever the agent did with its money, so the two can't disagree.
    const buying = final.action === "BUY";
    const pledges: Pledge[] = await Promise.all(
      AGENT_ORDER.filter((a) => a !== leader).map(async (agent) => {
        const p = await think(agent, (b) => b.pledge(agent, ctx, final, pitches, exchanges));
        const stakeUsd = p.support && buying ? Math.floor(clamp(p.stakeUsd, 0, before.cash[agent])) : 0;
        const support = p.support && (!buying || stakeUsd >= 1);
        return { agent, to: leader, emotion: p.emotion, say: p.say, source: p.source, support, stakeUsd: support ? stakeUsd : 0, reason: p.reason || (support ? "backs the trade" : "does not back the trade") };
      }),
    );

    const wanted = zeroStakes();
    wanted[leader] = pitches.find((p) => p.agent === leader)?.stakeUsd ?? 0;
    for (const p of pledges) wanted[p.agent] = p.stakeUsd;
    const stakes = buying ? fitStakes(before, final.token, wanted, prices) : zeroStakes();
    const totalUsd = AGENT_ORDER.reduce((t, a) => t + stakes[a], 0);

    const yes = 1 + pledges.filter((p) => p.support).length;
    const tooSmall = buying && totalUsd === 0;
    const approved = yes >= VOTES_TO_PASS && !tooSmall;

    const votes: Vote[] = AGENT_ORDER.map((agent) => {
      if (agent === leader) return { agent, approve: true, reason: "leads the proposal" };
      const p = pledges.find((x) => x.agent === agent)!;
      return { agent, approve: p.support, reason: p.reason };
    });

    const c = await think(leader, (b) => b.closing(leader, ctx, final, { pledges, approved, yes, totalUsd }));
    const closing: Line = { agent: leader, emotion: c.emotion, say: c.say, source: c.source };
    run.push({ stage: "decision", pledges, closing, votes, approved });

    // 4. Order
    let fill: Fill | null = null;
    let after: Portfolio = before;
    let note: string;

    if (!approved) {
      note = tooSmall && yes >= VOTES_TO_PASS ? "Passed the vote, but the order was under the desk's minimum size after limits. No trade." : `Proposal rejected ${yes} to ${4 - yes}. No trade this round.`;
    } else {
      const price = await market.price(final.token).catch(() => prices[final.token]!);
      const ts = Date.now();
      const id = `r${run.id}-${final.token}-${ts}`;
      const saved = await updateState((s) => {
        const done = buying
          ? buy(s.portfolio, { token: final.token, price, stakes, stopPct: final.stopPct, targetPct: final.targetPct, round: run.id, leader, ts, id })
          : sell(s.portfolio, { token: final.token, price, fraction: final.sellPct / 100, reason: "COUNCIL", round: run.id, leader, ts, id });
        if (!done) return s;
        fill = done.fill;
        return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill], lastRiskCheck: ts };
      });
      after = saved.portfolio;
      const f = fill as Fill | null;
      note = !f
        ? "The order could not be placed. No trade."
        : buying
          ? `Bought ${usd(f.usd)} of ${f.token} at ${px(price)}. Stop ${final.stopPct}% below, target ${final.targetPct}% above.`
          : `Sold ${final.sellPct}% of ${f.token} at ${px(price)}. Realized ${signed(f.realized ?? 0, "")} USDC.`;
    }

    const summary = approved && fill
      ? `Round ${run.id}: council ${buying ? "bought" : "sold"} ${final.token}, led by ${nameOf(leader)} (passed ${yes} to ${4 - yes}).`
      : `Round ${run.id}: ${nameOf(leader)} proposed to ${final.action} ${final.token}; rejected ${yes} to ${4 - yes}.`;
    await updateState((s) => ({ ...s, recent: [...s.recent, summary] }));
    run.push({ stage: "outcome", fill, portfolio: after, note });
  } catch (e) {
    console.error("[council] round failed:", e);
    run.failed = true;
    run.push({ stage: "error", message: "The council could not complete this round. It will try again at the next session." });
  } finally {
    run.finish();
  }
}
