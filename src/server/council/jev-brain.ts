/**
 * The Oracle, backed by Jev. Jev is an evaluation model: it answers typed questions
 * with probabilities and scores and writes no text. Every number The Oracle speaks
 * is Jev's answer; the sentence around it is a template.
 */
import { gateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate, type Experimental_EvaluationQuestion as Question } from "ai";
import type { Emotion } from "@/lib/council";
import type { Proposal } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";
import { clamp, type Brain } from "./brain";
import type { CouncilConfig } from "./config";
import { briefingState, describeDebate, describePitches, describeProposal, nameOf, px, type RoundCtx } from "./context";

const BUY_ABOVE = 0.56;
const SELL_BELOW = 0.44;
/** Backs a sale when it thinks the price is more likely to fall than not. */
const SELL_ABOVE = 0.52;
/** Backs a purchase when its expected value clears this many percent. */
const MIN_EDGE_PCT = 0.3;

const REASONING_SCALE = [
  "contradicts the market data",
  "not supported by the market data",
  "partly supported by the market data",
  "mostly supported by the market data",
  "fully supported by the market data",
];

const pct = (p: number) => `${Math.round(p * 100)}%`;
const short = (a: AgentId) => nameOf(a).replace("The ", "");

/**
 * Expected return in percent of a trade that wins `targetPct` with probability p and
 * otherwise loses `stopPct`. A 2-to-1 payoff is worth taking well below even odds.
 */
const expectedPct = (p: number, proposal: Proposal) => p * proposal.targetPct - (1 - p) * proposal.stopPct;

/** Jev's probability for the proposal, and whether it is good enough to back. */
function judge(p: number, proposal: Proposal) {
  if (proposal.action === "SELL") {
    return { backs: p >= SELL_ABOVE, strength: clamp((p - 0.5) * 2, 0, 1), view: `I put ${pct(p)} on ${proposal.token} trading lower an hour from now.` };
  }
  const ev = expectedPct(p, proposal);
  return {
    backs: ev >= MIN_EDGE_PCT,
    strength: clamp(ev / 5, 0, 1),
    view: `I put ${pct(p)} on this reaching its ${proposal.targetPct}% target before its ${proposal.stopPct}% stop, an expected ${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%.`,
  };
}

/** Conviction 1..5 from how far a probability sits from a coin flip. */
const conviction = (p: number) => Math.round(clamp(1 + Math.abs(p - 0.5) * 16, 1, 5));

export function jevBrain(cfg: CouncilConfig): Brain {
  async function ask(agent: AgentId, state: unknown, questions: Record<string, Question>) {
    const { answers } = await evaluate({
      model: gateway.evaluationModel(cfg.modelIds[agent]),
      state: state as Parameters<typeof evaluate>[0]["state"],
      questions,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(cfg.callTimeoutMs),
    });
    const all = answers as Record<string, { type: string; probability?: number; score?: number }>;
    return {
      probability(key: string) {
        const a = all[key];
        if (a?.type !== "boolean" || typeof a.probability !== "number") throw new Error(`Jev gave no probability for "${key}"`);
        return clamp(a.probability, 0, 1);
      },
      score(key: string) {
        const a = all[key];
        if (a?.type !== "score" || typeof a.score !== "number") throw new Error(`Jev gave no score for "${key}"`);
        return a.score;
      },
    };
  }

  const worksQuestion = (ctx: RoundCtx, p: Proposal): Question => {
    const price = ctx.prices[p.token] ?? 0;
    return p.action === "BUY"
      ? {
          type: "boolean",
          instructions: `If the desk buys ${p.token} now at ${px(price)}, with a stop-loss ${p.stopPct}% below and a profit target ${p.targetPct}% above, will the price reach the target before it reaches the stop?`,
        }
      : { type: "boolean", instructions: `Will ${p.token} trade lower one hour from now than its current price of ${px(price)}?` };
  };

  return {
    async pitch(agent, ctx) {
      const questions: Record<string, Question> = {};
      for (const s of ctx.stats) {
        questions[`up_${s.token}`] = {
          type: "boolean",
          instructions: `Will ${s.token} trade higher one hour from now than its current price of ${px(s.price)}?`,
        };
      }
      const a = await ask(agent, briefingState(ctx, agent), questions);
      const odds = ctx.stats.map((s) => ({ token: s.token, p: a.probability(`up_${s.token}`) }));
      const cash = ctx.portfolio.cash[agent];
      const base = { stopPct: 4, targetPct: 8, sellPct: 100, stakeUsd: 0 };

      const weakest = odds.filter((o) => ctx.sellable.includes(o.token)).sort((x, y) => x.p - y.p)[0];
      if (weakest && weakest.p < SELL_BELOW) {
        return {
          ...base,
          action: "SELL",
          token: weakest.token,
          conviction: conviction(weakest.p),
          emotion: "worried",
          say: `I put only ${pct(weakest.p)} on ${weakest.token} trading higher an hour from now. The odds have turned against that position, so I want to sell it.`,
        };
      }

      const best = [...odds].sort((x, y) => y.p - x.p)[0];
      if (best.p >= BUY_ABOVE && cash >= 10) {
        const c = conviction(best.p);
        return {
          ...base,
          action: "BUY",
          token: best.token,
          stakeUsd: Math.floor(cash * 0.1 * c),
          conviction: c,
          emotion: c >= 4 ? "confident" : "neutral",
          say: `I put ${pct(best.p)} on ${best.token} trading higher an hour from now. That is the best edge on the board, so I am buying.`,
        };
      }

      return {
        ...base,
        action: "HOLD",
        token: best.token,
        conviction: 3,
        emotion: "skeptical",
        say: `Nothing clears my bar. My best read is ${best.token} at ${pct(best.p)} to rise in the next hour, which is too close to a coin flip. I hold.`,
      };
    },

    async challenge(agent, ctx, proposal, pitches) {
      const state = { ...briefingState(ctx, agent), proposal: describeProposal(proposal), pitches: describePitches(pitches) };
      const a = await ask(agent, state, {
        works: worksQuestion(ctx, proposal),
        reasoning: {
          type: "score",
          instructions: `How well is ${nameOf(proposal.leader)}'s stated reasoning supported by the market data?`,
          criteria: REASONING_SCALE,
        },
      });
      const verdict = judge(a.probability("works"), proposal);
      const grade = (a.score("reasoning") + 1).toFixed(1);
      return {
        emotion: verdict.backs ? "confident" : "skeptical",
        say: `@${short(proposal.leader)} ${verdict.view} Your reasoning scores ${grade} out of 5 against the data. ${
          verdict.backs ? "That is good enough for me." : "I am not convinced."
        }`,
      };
    },

    async reply(agent, ctx, proposal, challenge) {
      const state = { ...briefingState(ctx, agent), myProposal: describeProposal(proposal), objection: challenge.say };
      const a = await ask(agent, state, {
        valid: {
          type: "boolean",
          instructions: "Does the objection point to a real weakness in the proposal, judged against the market data?",
        },
      });
      const p = a.probability("valid");
      const concede = p >= 0.6 && proposal.action === "BUY";
      const stopPct = concede ? Math.max(2, proposal.stopPct - 1) : proposal.stopPct;
      return {
        emotion: concede ? "worried" : "confident",
        stopPct,
        targetPct: proposal.targetPct,
        say: `@${short(challenge.agent)} I put ${pct(p)} on that being a real weakness. ${
          concede ? `Fair point. I will tighten the stop to ${stopPct}%.` : "It does not change my odds, so the proposal stands."
        }`,
      };
    },

    async pledge(agent, ctx, proposal, pitches, debate) {
      const state = {
        ...briefingState(ctx, agent),
        proposal: describeProposal(proposal),
        pitches: describePitches(pitches),
        debate: describeDebate(debate),
      };
      const a = await ask(agent, state, { works: worksQuestion(ctx, proposal) });
      const p = a.probability("works");
      const verdict = judge(p, proposal);
      const buying = proposal.action === "BUY";
      const stakeUsd = verdict.backs && buying ? Math.floor(ctx.portfolio.cash[agent] * clamp(verdict.strength, 0.1, 0.4)) : 0;
      const support = verdict.backs && (!buying || stakeUsd >= 1);
      const emotion: Emotion = support ? (verdict.strength >= 0.3 ? "confident" : "neutral") : "skeptical";
      const act = support
        ? buying
          ? `I am in for $${stakeUsd}.`
          : "I vote to sell."
        : buying
          ? "That does not pay for the risk, so I am keeping my cash out."
          : "I vote to keep holding.";
      return {
        support,
        stakeUsd: support ? stakeUsd : 0,
        emotion,
        reason: buying ? `${pct(p)} odds, expected ${expectedPct(p, proposal).toFixed(1)}%` : `${pct(p)} odds of a lower price`,
        say: `${verdict.view} ${act}`,
      };
    },

    // A closing line carries no judgement, so it needs no model call.
    async closing(_agent, _ctx, proposal, input) {
      if (!input.approved) {
        return { emotion: "neutral", say: `The proposal fails with ${input.yes} of 4 votes. The odds did not persuade the desk. No trade.` };
      }
      return {
        emotion: "confident",
        say:
          proposal.action === "BUY"
            ? `Passed ${input.yes} to ${4 - input.yes}. The desk buys $${input.totalUsd.toFixed(0)} of ${proposal.token}.`
            : `Passed ${input.yes} to ${4 - input.yes}. The desk sells ${proposal.sellPct}% of its ${proposal.token}.`,
      };
    },
  };
}
