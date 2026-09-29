/**
 * Rule-based stand-in for an agent. Used when no gateway key is configured, when the
 * daily budget is spent, or when a model call fails. It reads the same real market
 * data as the models and only quotes numbers from it.
 */
import { positionOf, type Emotion } from "@/lib/council";
import type { Proposal, TokenStats } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";
import { backers, clamp, presents, requestStake, weighs, type Brain } from "./brain";
import { nameOf, signed, type RoundCtx } from "./context";
import { pick } from "./skills";

const BUY_ABOVE: Record<AgentId, number> = { quant: 0.35, degen: 0.25, guardian: 0.5, oracle: 0.4 };
const SELL_BELOW: Record<AgentId, number> = { quant: -0.3, degen: -0.4, guardian: -0.15, oracle: -0.3 };
const SIZE: Record<AgentId, number> = { quant: 0.3, degen: 0.5, guardian: 0.15, oracle: 0.25 };
const STOP: Record<AgentId, number> = { quant: 4, degen: 6, guardian: 3, oracle: 4 };

const short = (a: AgentId) => nameOf(a).replace("The ", "");
const unit = (n: number, scale: number) => clamp(n / scale, -1, 1);

/** How much this agent likes a token right now, from -1 (sell) to 1 (buy). */
function edge(agent: AgentId, s: TokenStats): number {
  const momentum = unit(s.change1h, 1.5) * 0.5 + unit(s.rsi14 - 50, 25) * 0.3 + unit((s.volRatio ?? 1) - 1, 1.5) * 0.2;
  switch (agent) {
    case "quant":
      return momentum - (s.rsi14 > 72 ? 0.4 : 0);
    case "degen":
      return clamp(momentum * 1.3 + unit(s.change24h, 8) * 0.3, -1, 1);
    case "guardian":
      return momentum * 0.6 - 0.15 + (s.rsi14 < 32 ? 0.3 : 0);
    case "oracle":
      return momentum * 0.9;
  }
}

const statsFor = (ctx: RoundCtx, token: string) => ctx.stats.find((s) => s.token === token) ?? ctx.stats[0];
const volume = (s: TokenStats) => (s.volRatio === null ? `trend ${s.trend}` : `volume ${s.volRatio}x`);
const facts = (s: TokenStats) => `${s.token} ${signed(s.change1h)} 1h, RSI ${s.rsi14}, ${volume(s)}`;
const swing = (s: TokenStats) => `${s.token} ${signed(s.change15m)} 15m, ${signed(s.change4h)} 4h`;

/** Ways to decline a token, each resting on a different figure. */
const declines = (s: TokenStats) => [
  `${facts(s)}. I would stay out.`,
  `${swing(s)}. Not for my cash.`,
  `${s.token} moves ${s.atrPct}% per 5m, trend ${s.trend}. I pass.`,
  `${s.token} sits at ${s.rangePos}% of its day range. No entry for me.`,
  `${s.token} ${signed(s.change24h)} on the day, trend ${s.trend}. I keep my cash.`,
  `RSI ${s.rsi14} on ${s.token}, ${volume(s)}. Nothing to buy.`,
  `${s.token} ${signed(s.change24h)} on the day. I want a turn first.`,
];

/** Ways to refuse cash to a purchase. */
const refusals = (s: TokenStats) => [
  `Out. ${s.token} RSI ${s.rsi14} does not pay for the risk.`,
  `None of my cash. ${swing(s)}.`,
  `I pass. ${s.token} trend ${s.trend}, ${volume(s)}.`,
  `Staying out. ${s.token} moves ${s.atrPct}% per 5m for no edge.`,
  `No. ${s.token} at ${s.rangePos}% of its day range, no bid.`,
  `Not from me. ${s.token} ${signed(s.change4h)} over 4h, RSI ${s.rsi14}.`,
  `I keep my cash. ${s.token} ${signed(s.change24h)} on the day.`,
];

const BUY_LINE: Record<AgentId, (s: TokenStats) => string> = {
  quant: (s) => `${facts(s)}. Momentum and volume agree. Long.`,
  degen: (s) => `${s.token} leads: ${signed(s.change1h)} 1h, ${volume(s)}. I want size.`,
  guardian: (s) => `${facts(s)}. Acceptable, small size, tight stop.`,
  oracle: (s) => `${facts(s)}. Evidence favours the upside. Buy.`,
};

/** Several ways to say "no trade", each leaning on different figures. */
const HOLD_LINES: Record<AgentId, (s: TokenStats) => string[]> = {
  quant: (s) => [`Best is ${facts(s)}. Not enough. Hold.`, `Timeframes disagree: ${swing(s)}. No trade.`, `${s.token} trend ${s.trend}, RSI ${s.rsi14}. Neutral. Cash.`],
  degen: (s) => [`No momentum. ${s.token} only ${signed(s.change1h)} 1h. Pass.`, `Nothing breaking out. ${swing(s)}. Waiting.`, `${s.token} ${signed(s.change4h)} over 4h. Too weak to chase.`],
  guardian: (s) => [`Nothing pays for the risk. ${facts(s)}. Hold.`, `${s.token} moves ${s.atrPct}% per 5m. Edge is inside the noise.`, `${swing(s)}. Reward does not cover risk. Cash.`],
  oracle: (s) => [`${facts(s)}. Coin flip. Hold.`, `No edge. ${swing(s)}. Even odds.`, `Readings flat, ${s.token} least weak. I wait.`],
};

export function scriptedBrain(): Brain {
  const verdict = (agent: AgentId, ctx: RoundCtx, p: Proposal) => {
    const s = statsFor(ctx, p.token);
    const e = edge(agent, s);
    return { s, e, support: p.action === "BUY" ? e > BUY_ABOVE[agent] - 0.2 : e < SELL_BELOW[agent] + 0.25 };
  };

  return {
    async pitch(agent, ctx) {
      const ranked = ctx.stats.map((s) => ({ s, e: edge(agent, s) })).sort((a, b) => b.e - a.e);
      const base = { stopPct: STOP[agent], targetPct: STOP[agent] * 2, sellPct: 100, stakeUsd: 0 };

      if (presents(agent, ctx)) {
        const r = ctx.request!;
        const s = statsFor(ctx, r.asset.key);
        const e = edge(agent, s);
        const stake = requestStake(ctx, agent, 0);
        return {
          ...base,
          action: "BUY",
          token: r.asset.key,
          stakeUsd: stake,
          conviction: Math.round(clamp(1 + e * 5, 1, 5)),
          emotion: e > BUY_ABOVE[agent] ? "confident" : "neutral",
          say: pick(
            positionOf(ctx.portfolio, s.token)
              ? [`Adding $${stake} ${s.token} for a funder. ${swing(s)}.`, `Another funder wants ${s.token}. $${stake} more. ${volume(s)}, trend ${s.trend}.`]
              : r.mode === "commit"
                ? [`Funder's request: ${facts(s)}. Committed for $${stake}.`, `My funder asked for ${s.token}. ${swing(s)}. I take $${stake}.`]
                : [`Funder's request: ${facts(s)}. The desk decides.`, `My funder asked for ${s.token}. ${swing(s)}. Your call, desk.`], ctx, agent),
        };
      }

      if (weighs(agent, ctx)) {
        const s = statsFor(ctx, ctx.request!.asset.key);
        const e = edge(agent, s);
        const joins = e > BUY_ABOVE[agent] && ctx.portfolio.cash[agent] >= 10;
        return {
          ...base,
          action: joins ? "BUY" : "HOLD",
          token: s.token,
          stakeUsd: joins ? Math.floor(ctx.portfolio.cash[agent] * SIZE[agent] * 0.5) : 0,
          conviction: Math.round(clamp(1 + Math.abs(e) * 5, 1, 5)),
          emotion: joins ? "confident" : "skeptical",
          say: joins
            ? pick([`${facts(s)}. I would join.`, `${swing(s)}. Enough for me.`, `${s.token} trend ${s.trend}, ${volume(s)}. I could back it.`], ctx, agent)
            : pick(declines(s), ctx, agent),
        };
      }

      const weak = ranked.filter((r) => ctx.sellable.includes(r.s.token)).sort((a, b) => a.e - b.e)[0];
      if (weak && weak.e < SELL_BELOW[agent]) {
        return {
          ...base,
          action: "SELL",
          token: weak.s.token,
          conviction: Math.round(clamp(2 + Math.abs(weak.e) * 4, 1, 5)),
          emotion: "worried",
          say: `${facts(weak.s)}. It has turned. Sell.`,
        };
      }

      const best = ranked[0];
      const cash = ctx.portfolio.cash[agent];
      if (best.e > BUY_ABOVE[agent] && cash >= 10) {
        const c = Math.round(clamp(1 + best.e * 5, 1, 5));
        return {
          ...base,
          action: "BUY",
          token: best.s.token,
          stakeUsd: Math.floor(cash * SIZE[agent] * clamp(best.e + 0.4, 0.4, 1)),
          conviction: c,
          emotion: "confident",
          say: BUY_LINE[agent](best.s),
        };
      }
      return { ...base, action: "HOLD", token: best.s.token, conviction: 3, emotion: "neutral", say: pick(HOLD_LINES[agent](best.s), ctx, agent) };
    },

    async challenge(agent, ctx, proposal) {
      const { s, support } = verdict(agent, ctx, proposal);
      const to = `@${short(proposal.leader)}`;
      const act = proposal.action === "BUY" ? "buy" : "sell";
      if (support) return { emotion: "confident", say: pick([`${to} ${facts(s)}. Numbers back you.`, `${to} ${swing(s)}. I see it too.`], ctx, agent) };
      return {
        emotion: agent === "guardian" ? "worried" : "skeptical",
        say: pick(
          [`${to} ${facts(s)}. Not enough to ${act} on.`, `${to} ${swing(s)}. Where is the edge?`, `${to} ${s.token} moves ${s.atrPct}% per 5m. Your stop sits in the noise.`], ctx, agent),
      };
    },

    async reply(agent, ctx, proposal, challenge) {
      const s = statsFor(ctx, proposal.token);
      const gives = challenge.agent === "guardian" && proposal.action === "BUY";
      // Giving way to "your stop sits in the noise" means moving the stop away, not closer.
      const widen = /noise|too tight/i.test(challenge.say);
      const stopPct = !gives ? proposal.stopPct : widen ? Math.min(10, proposal.stopPct + 2) : Math.max(2, proposal.stopPct - 1);
      const tighten = gives;
      const moved = widen ? "widened" : "tightened";
      return {
        emotion: tighten ? "neutral" : "confident",
        stopPct,
        targetPct: proposal.targetPct,
        say: pick(
          tighten
            ? [`@${short(challenge.agent)} Fair. Stop ${moved} to ${stopPct}%.`, `@${short(challenge.agent)} Agreed. Stop ${moved} to ${stopPct}%.`]
            : [`@${short(challenge.agent)} ${facts(s)}. Proposal stands.`, `@${short(challenge.agent)} ${swing(s)}. Terms unchanged.`, `@${short(challenge.agent)} Heard. I keep the stop where it is.`], ctx, agent),
      };
    },

    async pledge(agent, ctx, proposal) {
      const { s, e, support } = verdict(agent, ctx, proposal);
      const buying = proposal.action === "BUY";
      const stakeUsd = support && buying ? Math.floor(ctx.portfolio.cash[agent] * SIZE[agent] * 0.6) : 0;
      const emotion: Emotion = support ? "confident" : agent === "guardian" ? "worried" : "skeptical";
      if (support && buying && stakeUsd < 5) {
        return { support: false, stakeUsd: 0, emotion: "neutral", reason: "no cash free to commit", say: "No cash free. I can't back it." };
      }
      return {
        support,
        stakeUsd,
        emotion,
        reason: support ? `${s.token} momentum supports it` : `${s.token} edge too weak (${e.toFixed(2)})`,
        say: pick(
          support
            ? buying
              ? [`In for $${stakeUsd} on ${s.token}.`, `$${stakeUsd} from me. ${swing(s)}.`, `I join with $${stakeUsd}. ${volume(s)}.`]
              : [`Agreed. Sell ${s.token}.`, `Close ${s.token}. ${swing(s)}.`]
            : buying
              ? refusals(s)
              : [`Keep holding ${s.token}. Move not confirmed.`, `No sale. ${swing(s)}.`], ctx, agent),
      };
    },

    async closing(agent, ctx, proposal, input) {
      const size = `$${input.totalUsd.toFixed(0)}`;
      const t = proposal.token;
      const tally = `${input.yes} to ${4 - input.yes}`;
      if (input.committed && input.approved) {
        const with_ = backers(input.pledges, short);
        return { emotion: "neutral", say: pick([`Buying ${size} ${t} for my funder. Joined by ${with_}.`, `${size} of ${t} goes in, as asked. With me: ${with_}.`], ctx, agent) };
      }
      if (!input.approved) return { emotion: "sad", say: pick([`Fails ${tally}. No trade.`, `${tally}. The desk says no. Standing down.`], ctx, agent) };
      return {
        emotion: "happy",
        say:
          proposal.action === "BUY"
            ? pick([`Passed ${tally}. Buying ${size} ${t}.`, `Carried ${tally}. ${size} of ${t} goes in.`], ctx, agent)
            : pick([`Passed ${tally}. Selling ${proposal.sellPct}% of ${t}.`, `Carried ${tally}. ${proposal.sellPct}% of ${t} comes off.`], ctx, agent),
      };
    },
  };
}
