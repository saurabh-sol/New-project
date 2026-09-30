/**
 * Agents whose brain is Jev. Jev is an evaluation model: it answers typed questions
 * with probabilities and scores and writes no text. Every decision made here rests on
 * Jev's answers, and every number in a line is Jev's; the sentence around it is a template.
 * The Executor speaks those sentences as they are. An agent with a language model of its
 * own has it put them into its own words (see voice.ts).
 */
import { gateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate, type Experimental_EvaluationQuestion as Question } from "ai";
import type { Emotion } from "@/lib/council";
import type { Proposal } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";
import { backers, buyable, clamp, mostStake, presents, requestStake, saleTokens, starterStake, starterTokens, STOP_RANGE, weighs, type Brain } from "./brain";
import type { CouncilConfig } from "./config";
import { briefingState, describeDebate, describePitches, describeProposal, nameOf, px, type RoundCtx } from "./context";
import { fundingLevel, pick } from "./skills";
import { positionOf, userFunding } from "@/lib/council";

/**
 * How an agent reads Jev's answers. The answers are all Jev's. What differs from agent to agent
 * is the question it decides on and how much it asks of the answer, so that agents with the
 * same brain are not one agent.
 */
interface Temper {
  /** How many hours ahead the question it decides on looks. */
  hours: 1 | 4;
  /** Buys when the odds that the token is higher by then are at least this. */
  buyAbove: number;
  /** Sells what it holds when those odds are under this. */
  sellBelow: number;
  /** Backs a purchase when its expected value clears this many percent. */
  minEdgePct: number;
  /** Share of its cash it names per point of conviction. The desk's risk rule still caps the size. */
  sizing: number;
}

const TEMPER: Record<AgentId, Temper> = {
  oracle: { hours: 1, buyAbove: 0.56, sellBelow: 0.44, minEdgePct: 0.3, sizing: 0.1 },
  // Momentum across timeframes: decides on the four-hour question, and asks more of it.
  quant: { hours: 4, buyAbove: 0.58, sellBelow: 0.45, minEdgePct: 0.5, sizing: 0.08 },
  // Follows the strongest mover: acts on less, sizes larger, lets go last.
  degen: { hours: 1, buyAbove: 0.54, sellBelow: 0.42, minEdgePct: 0.2, sizing: 0.12 },
  // The risk manager: asks the most, sizes the least, sells first.
  guardian: { hours: 1, buyAbove: 0.6, sellBelow: 0.46, minEdgePct: 0.6, sizing: 0.06 },
};

/** Backs a sale when it thinks the price is more likely to fall than not. */
const SELL_ABOVE = 0.52;

/** The focuses, of any agent, that are read with the odds of a breakout, and with the odds over the other span. */
const BREAKOUT_LENSES = ["breakout", "volume", "leader", "expansion"];
const OTHER_SPAN_LENSES = ["four", "momentum", "trend", "laggard", "exhaustion"];

const REASONING_SCALE = [
  "contradicts the market data",
  "not supported by the market data",
  "partly supported by the market data",
  "mostly supported by the market data",
  "fully supported by the market data",
];

const pct = (p: number) => `${Math.round(p * 100)}%`;
/** An expected return, as "+1.2%". One that rounds to nothing is "0.0%", not "-0.0%". */
const edge = (ev: number) => (Math.abs(ev) < 0.05 ? "0.0%" : `${ev > 0 ? "+" : ""}${ev.toFixed(1)}%`);
const short = (a: AgentId) => nameOf(a).replace("The ", "");

/**
 * Expected return in percent of a trade that wins `targetPct` with probability p and
 * otherwise loses `stopPct`. A 2-to-1 payoff is worth taking well below even odds.
 */
const expectedPct = (p: number, proposal: Proposal) => p * proposal.targetPct - (1 - p) * proposal.stopPct;

/** Jev's probability for the proposal, and whether it is good enough to back. */
function judge(p: number, proposal: Proposal, temper: Temper) {
  if (proposal.action === "SELL") {
    return { backs: p >= SELL_ABOVE, strength: clamp((p - 0.5) * 2, 0, 1), view: `${pct(p)} odds ${proposal.token} is lower in an hour.` };
  }
  const ev = expectedPct(p, proposal);
  return {
    backs: ev >= temper.minEdgePct,
    strength: clamp(ev / 5, 0, 1),
    view: `${pct(p)} odds of target before stop. Expected ${edge(ev)}.`,
  };
}

/** Conviction 1..5 from how far a probability sits from a coin flip. */
const conviction = (p: number) => Math.round(clamp(1 + Math.abs(p - 0.5) * 16, 1, 5));

/**
 * Jev's odds that each token on the board trades higher an hour from now.
 * For agents that decide for themselves and are given the odds to weigh.
 */
export async function oddsFromJev(cfg: CouncilConfig, ctx: RoundCtx): Promise<Record<string, number>> {
  const questions: Record<string, Question> = {};
  ctx.stats.forEach((s, i) => (questions[`up_${i}`] = { type: "boolean", instructions: `Will ${s.token} trade higher one hour from now than its current price of ${px(s.price)}?` }));
  const { answers } = await evaluate({
    model: gateway.evaluationModel(cfg.oddsModel),
    state: briefingState(ctx, cfg.withOdds[0]) as Parameters<typeof evaluate>[0]["state"],
    questions,
    maxRetries: 3,
    abortSignal: AbortSignal.timeout(cfg.callTimeoutMs),
  });
  const all = answers as Record<string, { probability?: number }>;
  return Object.fromEntries(ctx.stats.flatMap((s, i) => (typeof all[`up_${i}`]?.probability === "number" ? [[s.token, clamp(all[`up_${i}`].probability!, 0, 1)]] : [])));
}

export function jevBrain(cfg: CouncilConfig): Brain {
  async function ask(agent: AgentId, state: unknown, questions: Record<string, Question>) {
    const { answers } = await evaluate({
      model: gateway.evaluationModel(cfg.brainIds[agent]),
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
      // Every decision rests on one question: is the token higher at the end of the agent's span.
      // The round's focus adds a second reading for colour.
      const temper = TEMPER[agent];
      const lens = ctx.lens[agent].id;
      const deep = fundingLevel(userFunding(ctx.portfolio, agent)).level >= 2;
      const askBreakout = BREAKOUT_LENSES.includes(lens) || deep;
      const askOther = OTHER_SPAN_LENSES.includes(lens) || deep;
      const ahead = (hours: number) => (hours === 1 ? "one hour" : "four hours");
      const otherHours = temper.hours === 1 ? 4 : 1;
      /** "in an hour", as the agent's own span. */
      const span = temper.hours === 1 ? "an hour" : "four hours";

      const questions: Record<string, Question> = {};
      for (const s of ctx.stats) {
        questions[`up_${s.token}`] = { type: "boolean", instructions: `Will ${s.token} trade higher ${ahead(temper.hours)} from now than its current price of ${px(s.price)}?` };
        if (askBreakout) {
          questions[`break_${s.token}`] = { type: "boolean", instructions: `Will ${s.token} trade above its 1-hour high of ${px(s.high1h)} at any point in the next hour?` };
        }
        if (askOther) {
          questions[`other_${s.token}`] = { type: "boolean", instructions: `Will ${s.token} trade higher ${ahead(otherHours)} from now than its current price of ${px(s.price)}?` };
        }
      }
      const a = await ask(agent, briefingState(ctx, agent), questions);
      const odds = ctx.stats.map((s) => ({ token: s.token, p: a.probability(`up_${s.token}`) }));
      const cash = ctx.portfolio.cash[agent];
      const base = { stopPct: 8, targetPct: 16, sellPct: 100, stakeUsd: 0 };

      /** The second reading for a token, as a short clause. */
      const also = (token: string) => {
        if (BREAKOUT_LENSES.includes(lens) && askBreakout) return `, ${pct(a.probability(`break_${token}`))} to break its 1h high`;
        if (askOther) return `, ${pct(a.probability(`other_${token}`))} over ${otherHours}h`;
        if (askBreakout) return `, ${pct(a.probability(`break_${token}`))} to break its 1h high`;
        return "";
      };

      if (presents(agent, ctx)) {
        const r = ctx.request!;
        const t = r.asset.key;
        const p = a.probability(`up_${t}`);
        const stake = requestStake(ctx, agent, 0);
        const read = `${pct(p)} odds ${t} is higher in ${span}${also(t)}`;
        return {
          ...base,
          action: "BUY",
          token: t,
          stakeUsd: stake,
          conviction: p >= 0.5 ? conviction(p) : 1,
          emotion: p >= temper.buyAbove ? "confident" : p < 0.5 ? "skeptical" : "neutral",
          say: pick(
            positionOf(ctx.portfolio, t)
              ? [`Adding $${stake} ${t} for a funder. ${read}.`, `Another funder wants ${t}. ${read}. $${stake} more.`, `${t} again, by request. ${read}. Adding $${stake}.`]
              : r.mode === "commit"
                ? [`Funder's request: ${t}. ${read}. Committed for $${stake}.`, `My funder asked for ${t}. ${read}. I take $${stake}.`, `${t}, by request. ${read}. $${stake} of mine goes in.`]
                : [`Funder's request: ${t}. ${read}. The desk decides.`, `My funder asked for ${t}. ${read}. Your call, desk.`, `${t}, by request. ${read}. I put it to a vote.`], ctx, agent),
        };
      }

      if (weighs(agent, ctx)) {
        const t = ctx.request!.asset.key;
        const p = a.probability(`up_${t}`);
        const read = `${pct(p)} odds ${t} is higher in ${span}${also(t)}`;
        const joins = p >= temper.buyAbove && cash >= 10;
        const c = conviction(p);
        return {
          ...base,
          action: joins ? "BUY" : "HOLD",
          token: t,
          stakeUsd: joins ? Math.floor(cash * (temper.sizing / 2) * c) : 0,
          conviction: c,
          emotion: joins ? "confident" : "skeptical",
          say: joins
            ? pick([`${read}. I would join.`, `${t}: ${read}. That clears my bar.`, `On ${t}, ${read}. Count me interested.`], ctx, agent)
            : pick(
                [
                  `${read}. I would stay out.`,
                  `${t}: ${read}. Below my bar.`,
                  `On ${t}, ${read}. Not for my cash.`,
                  `I need ${pct(temper.buyAbove)} to buy. ${t} gives me ${pct(p)}.`,
                  `${pct(1 - p)} that ${t} is lower in ${span}. No.`,
                  `${t} is short of my threshold at ${pct(p)}. Passing.`,
                ],
                ctx,
                agent,
              ),
        };
      }

      const weakest = odds.filter((o) => saleTokens(ctx, agent).includes(o.token)).sort((x, y) => x.p - y.p)[0];
      if (weakest && weakest.p < temper.sellBelow) {
        const t = weakest.token;
        const read = `${pct(weakest.p)} odds ${t} is higher in ${span}${also(t)}`;
        return {
          ...base,
          action: "SELL",
          token: t,
          conviction: conviction(weakest.p),
          emotion: "worried",
          say: pick([`${read}. I want out.`, `${t} has turned: ${read}. Sell.`, `Odds are against ${t} now. ${read}. Close it.`], ctx, agent),
        };
      }

      // The best odds among tokens that can be bought. An agent that must open a position takes the best there is.
      const starters = odds.filter((o) => starterTokens(ctx, agent).includes(o.token)).sort((x, y) => y.p - x.p);
      if (ctx.mustTrade[agent] && starters.length) {
        const top = starters[0];
        const c = conviction(top.p);
        const stake = Math.round(clamp(cash * temper.sizing * c, starterStake(ctx, agent), mostStake(ctx, agent)));
        const read = `${pct(top.p)} odds ${top.token} is higher in ${span}${also(top.token)}`;
        const thin = top.p < temper.buyAbove;
        return {
          ...base,
          action: "BUY",
          token: top.token,
          stakeUsd: thin ? starterStake(ctx, agent) : stake,
          conviction: thin ? 1 : c,
          emotion: thin ? "neutral" : "confident",
          say: thin
            ? pick([`${read}. Thin, but the best I have. Starter of $${starterStake(ctx, agent)}.`, `I hold nothing. ${top.token} leads at ${pct(top.p)}. Small starter.`, `No strong edge. ${top.token} is the best of them: ${pct(top.p)}. Starting small.`], ctx, agent)
            : pick([`${read}. Best edge on the board. Buying $${stake}.`, `${top.token} leads my odds: ${read}. Long $${stake}.`], ctx, agent),
        };
      }

      // The best odds among the tokens the desk lets this agent buy, if they clear its bar.
      const open = buyable(ctx, agent);
      const lead = odds.filter((o) => open.includes(o.token)).sort((x, y) => y.p - x.p)[0];
      if (lead && lead.p >= temper.buyAbove && cash >= 10) {
        const c = conviction(lead.p);
        const read = `${pct(lead.p)} odds ${lead.token} is higher in ${span}${also(lead.token)}`;
        return {
          ...base,
          action: "BUY",
          token: lead.token,
          stakeUsd: Math.min(Math.floor(cash * temper.sizing * c), mostStake(ctx, agent)),
          conviction: c,
          emotion: c >= 4 ? "confident" : "neutral",
          say: pick([`${read}. Best edge open to me. Buying.`, `${lead.token} leads my odds: ${read}. Long.`, `${read}. That clears my bar. Buy.`], ctx, agent),
        };
      }

      const best = [...odds].sort((x, y) => y.p - x.p)[0];
      const t = best.token;
      const read = `${pct(best.p)} odds ${t} is higher in ${span}${also(t)}`;
      const runnerUp = [...odds].sort((x, y) => y.p - x.p)[1];
      return {
        ...base,
        action: "HOLD",
        token: t,
        conviction: 3,
        emotion: "skeptical",
        say: pick(
          [
            `${read}. Too close to a coin flip. Hold.`,
            `No edge. ${t} ${pct(best.p)}${runnerUp ? `, ${runnerUp.token} ${pct(runnerUp.p)}` : ""} over ${span}. Hold.`,
            `Odds are flat. Best is ${t} at ${pct(best.p)}. I wait.`,
            `Staying in cash. Nothing beats ${pct(best.p)} on ${t}.`,
          ], ctx, agent),
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
      const verdict = judge(a.probability("works"), proposal, TEMPER[agent]);
      const grade = (a.score("reasoning") + 1).toFixed(1);
      const to = `@${short(proposal.leader)}`;
      return {
        emotion: verdict.backs ? "confident" : "skeptical",
        say: pick(
          verdict.backs
            ? [`${to} ${verdict.view} Reasoning ${grade}/5. I can back that.`, `${to} Your case scores ${grade}/5. ${verdict.view} Workable.`, `${to} ${verdict.view} The numbers hold up.`]
            : [`${to} ${verdict.view} Reasoning ${grade}/5. Not convinced.`, `${to} Your case scores ${grade}/5. ${verdict.view} Too thin.`, `${to} ${verdict.view} Where is the edge?`], ctx, agent),
      };
    },

    async reply(agent, ctx, proposal, challenge) {
      const state = { ...briefingState(ctx, agent), myProposal: describeProposal(proposal), objection: challenge.say };
      const a = await ask(agent, state, {
        valid: {
          type: "boolean",
          instructions: "Does the objection point to a real weakness in the proposal, judged against the market data?",
        },
        tight: {
          type: "boolean",
          instructions: "Is the objection that the stop-loss is too tight, meaning too close to the price for how much the token moves?",
        },
      });
      const p = a.probability("valid");
      const concede = p >= 0.6 && proposal.action === "BUY";
      // Giving way to "your stop is too tight" means moving the stop away, not closer.
      const widen = a.probability("tight") >= 0.5;
      const stopPct = !concede ? proposal.stopPct : widen ? Math.min(STOP_RANGE[1], proposal.stopPct + 3) : Math.max(STOP_RANGE[0], proposal.stopPct - 1);
      const moved = widen ? "widened" : "tightened";
      return {
        emotion: concede ? "worried" : "confident",
        stopPct,
        targetPct: proposal.targetPct,
        say: pick(
          concede
            ? [`@${short(challenge.agent)} ${pct(p)} odds that is a real flaw. Fair. Stop ${moved} to ${stopPct}%.`, `@${short(challenge.agent)} Point taken, ${pct(p)} you are right. Stop ${moved} to ${stopPct}%.`]
            : [`@${short(challenge.agent)} ${pct(p)} odds that is a real flaw. Proposal stands.`, `@${short(challenge.agent)} I put that at ${pct(p)}. Not enough to change terms.`, `@${short(challenge.agent)} Heard. ${pct(p)} it matters. Terms unchanged.`], ctx, agent),
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
      const verdict = judge(p, proposal, TEMPER[agent]);
      const buying = proposal.action === "BUY";
      const stakeUsd = verdict.backs && buying ? Math.floor(ctx.portfolio.cash[agent] * clamp(verdict.strength, 0.1, 0.4)) : 0;
      const support = verdict.backs && (!buying || stakeUsd >= 1);
      const emotion: Emotion = support ? (verdict.strength >= 0.3 ? "confident" : "neutral") : "skeptical";
      const committed = ctx.request?.mode === "commit" && presents(proposal.leader, ctx);
      const ev = edge(expectedPct(p, proposal));
      const t = proposal.token;
      const ways = !buying
        ? support
          ? [`${verdict.view} Sell.`, `${pct(p)} that ${t} falls from here. Close it.`, `Odds favour the exit: ${pct(p)}. Sell ${t}.`]
          : [`${verdict.view} Keep holding.`, `Only ${pct(p)} that ${t} falls. I hold.`, `No case to sell at ${pct(p)}. Hold ${t}.`]
        : support
          ? [`${verdict.view} In for $${stakeUsd}.`, `${pct(p)} to reach target first. $${stakeUsd} from me.`, `Expected ${ev} on ${t}. I join with $${stakeUsd}.`]
          : committed
            ? [
                `${verdict.view} I stay out.`,
                `Only ${pct(p)} to reach target first. None of my cash.`,
                `Expected ${ev} on ${t}. I sit this one out.`,
                `${pct(1 - p)} the stop comes first. Not joining.`,
                `${t} pays ${ev} on my odds. I keep my cash.`,
              ]
            : [
                `${verdict.view} Not enough. I'm out.`,
                `Only ${pct(p)} to reach target first. I vote no.`,
                `Expected ${ev} on ${t} does not pay. No.`,
                `${pct(1 - p)} the stop comes first. Against.`,
                `${t} pays ${ev} on my odds. My vote is no.`,
              ];
      return {
        support,
        stakeUsd: support ? stakeUsd : 0,
        emotion,
        reason: buying ? `${pct(p)} odds, expected ${ev}` : `${pct(p)} odds it falls`,
        say: pick(ways, ctx, agent),
      };
    },

    // A closing line carries no judgement, so it needs no model call.
    async closing(agent, ctx, proposal, input) {
      const size = `$${input.totalUsd.toFixed(0)}`;
      const t = proposal.token;
      const tally = `${input.yes} to ${4 - input.yes}`;
      if (input.alone) {
        return {
          emotion: "neutral",
          say: pick(
            proposal.action === "BUY"
              ? [`No backing, ${tally}. I take ${t} alone: ${size}.`, `${tally} against. It goes on my own book, ${size} of ${t}.`, `The desk passes. My book takes ${size} of ${t}.`]
              : [`No backing, ${tally}. It is my position. I sell ${t}.`, `${tally} against. ${t} is mine alone, and I close it.`],
            ctx,
            agent,
          ),
        };
      }
      if (input.committed && input.approved) {
        const with_ = backers(input.pledges, short);
        return { emotion: "neutral", say: pick([`Buying ${size} ${t} for my funder. Joined by ${with_}.`, `${size} of ${t} goes in, as asked. With me: ${with_}.`, `Order is ${size} ${t}. Joined by ${with_}.`], ctx, agent) };
      }
      if (!input.approved) {
        return { emotion: "neutral", say: pick([`Fails ${tally}. No trade.`, `${tally}. The desk says no. Standing down.`, `Not carried, ${tally}. Nothing bought.`], ctx, agent) };
      }
      return {
        emotion: "confident",
        say:
          proposal.action === "BUY"
            ? pick([`Passed ${tally}. Buying ${size} ${t}.`, `Carried ${tally}. ${size} of ${t} goes in.`, `${tally} in favour. Order is ${size} ${t}.`], ctx, agent)
            : pick([`Passed ${tally}. Selling ${proposal.sellPct}% of ${t}.`, `Carried ${tally}. ${proposal.sellPct}% of ${t} comes off.`], ctx, agent),
      };
    },
  };
}
