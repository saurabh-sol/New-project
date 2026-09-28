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
import { freshest, fundingLevel } from "./skills";
import { userFunding } from "@/lib/council";

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
    return { backs: p >= SELL_ABOVE, strength: clamp((p - 0.5) * 2, 0, 1), view: `${pct(p)} odds ${proposal.token} is lower in an hour.` };
  }
  const ev = expectedPct(p, proposal);
  return {
    backs: ev >= MIN_EDGE_PCT,
    strength: clamp(ev / 5, 0, 1),
    view: `${pct(p)} odds of target before stop. Expected ${ev >= 0 ? "+" : ""}${ev.toFixed(1)}%.`,
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
      // The provider occasionally answers 502. The SDK waits longer between each retry.
      maxRetries: 3,
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
      // Every decision rests on the one-hour question. The round's focus adds a second reading for colour.
      const lens = ctx.lens[agent].id;
      const deep = fundingLevel(userFunding(ctx.portfolio, agent)).level >= 2;
      const askBreakout = lens === "breakout" || deep;
      const askFour = lens === "four" || deep;

      const questions: Record<string, Question> = {};
      for (const s of ctx.stats) {
        questions[`up_${s.token}`] = { type: "boolean", instructions: `Will ${s.token} trade higher one hour from now than its current price of ${px(s.price)}?` };
        if (askBreakout) {
          questions[`break_${s.token}`] = { type: "boolean", instructions: `Will ${s.token} trade above its 1-hour high of ${px(s.high1h)} at any point in the next hour?` };
        }
        if (askFour) {
          questions[`four_${s.token}`] = { type: "boolean", instructions: `Will ${s.token} trade higher four hours from now than its current price of ${px(s.price)}?` };
        }
      }
      const a = await ask(agent, briefingState(ctx, agent), questions);
      const odds = ctx.stats.map((s) => ({ token: s.token, p: a.probability(`up_${s.token}`) }));
      const cash = ctx.portfolio.cash[agent];
      const base = { stopPct: 4, targetPct: 8, sellPct: 100, stakeUsd: 0 };
      const said = ctx.said[agent];

      /** The second reading for a token, as a short clause. */
      const also = (token: string) => {
        if (lens === "breakout" && askBreakout) return `, ${pct(a.probability(`break_${token}`))} to break its 1h high`;
        if (askFour) return `, ${pct(a.probability(`four_${token}`))} over 4h`;
        if (askBreakout) return `, ${pct(a.probability(`break_${token}`))} to break its 1h high`;
        return "";
      };

      const weakest = odds.filter((o) => ctx.sellable.includes(o.token)).sort((x, y) => x.p - y.p)[0];
      if (weakest && weakest.p < SELL_BELOW) {
        const t = weakest.token;
        const read = `${pct(weakest.p)} odds ${t} is higher in an hour${also(t)}`;
        return {
          ...base,
          action: "SELL",
          token: t,
          conviction: conviction(weakest.p),
          emotion: "worried",
          say: freshest([`${read}. I want out.`, `${t} has turned: ${read}. Sell.`, `Odds are against ${t} now. ${read}. Close it.`], said),
        };
      }

      const best = [...odds].sort((x, y) => y.p - x.p)[0];
      const t = best.token;
      const read = `${pct(best.p)} odds ${t} is higher in an hour${also(t)}`;
      if (best.p >= BUY_ABOVE && cash >= 10) {
        const c = conviction(best.p);
        return {
          ...base,
          action: "BUY",
          token: t,
          stakeUsd: Math.floor(cash * 0.1 * c),
          conviction: c,
          emotion: c >= 4 ? "confident" : "neutral",
          say: freshest([`${read}. Best edge on the board. Buying.`, `${t} leads my odds: ${read}. Long.`, `${read}. That clears my bar. Buy.`], said),
        };
      }

      const runnerUp = [...odds].sort((x, y) => y.p - x.p)[1];
      return {
        ...base,
        action: "HOLD",
        token: t,
        conviction: 3,
        emotion: "skeptical",
        say: freshest(
          [
            `${read}. Too close to a coin flip. Hold.`,
            `No edge. ${t} ${pct(best.p)}, ${runnerUp.token} ${pct(runnerUp.p)} for the hour. Hold.`,
            `Odds are flat. Best is ${t} at ${pct(best.p)}. I wait.`,
            `Staying in cash. Nothing beats ${pct(best.p)} on ${t}.`,
          ],
          said,
        ),
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
        say: `@${short(proposal.leader)} ${verdict.view} Reasoning ${grade}/5. ${verdict.backs ? "I can back that." : "Not convinced."}`,
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
        say: `@${short(challenge.agent)} ${pct(p)} odds that is a real flaw. ${concede ? `Fair. Stop tightened to ${stopPct}%.` : "Proposal stands."}`,
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
      const act = support ? (buying ? `In for $${stakeUsd}.` : "Sell.") : buying ? "Not enough. I'm out." : "Keep holding.";
      return {
        support,
        stakeUsd: support ? stakeUsd : 0,
        emotion,
        reason: buying ? `${pct(p)} odds, expected ${expectedPct(p, proposal).toFixed(1)}%` : `${pct(p)} odds it falls`,
        say: `${verdict.view} ${act}`,
      };
    },

    // A closing line carries no judgement, so it needs no model call.
    async closing(_agent, _ctx, proposal, input) {
      if (!input.approved) {
        return { emotion: "neutral", say: `Fails ${input.yes} to ${4 - input.yes}. No trade.` };
      }
      return {
        emotion: "confident",
        say:
          proposal.action === "BUY"
            ? `Passed ${input.yes} to ${4 - input.yes}. Buying $${input.totalUsd.toFixed(0)} ${proposal.token}.`
            : `Passed ${input.yes} to ${4 - input.yes}. Selling ${proposal.sellPct}% of ${proposal.token}.`,
      };
    },
  };
}
