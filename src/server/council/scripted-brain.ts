/**
 * Rule-based stand-in for an agent. Used when no gateway key is configured, when the
 * daily budget is spent, or when a model call fails. It reads the same real market
 * data as the models and only quotes numbers from it.
 */
import type { Emotion } from "@/lib/council";
import type { Proposal, TokenStats } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";
import { clamp, type Brain } from "./brain";
import { nameOf, signed, type RoundCtx } from "./context";
import { freshest } from "./skills";

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

const volume = (s: TokenStats) => (s.volRatio === null ? `a ${s.trend} trend` : `volume at ${s.volRatio}x average`);
const facts = (s: TokenStats) => `${s.token} is ${signed(s.change1h)} in the last hour with RSI ${s.rsi14} and ${volume(s)}`;
const statsFor = (ctx: RoundCtx, token: string) => ctx.stats.find((s) => s.token === token) ?? ctx.stats[0];

const BUY_LINE: Record<AgentId, (s: TokenStats) => string> = {
  quant: (s) => `${facts(s)}. Momentum and volume agree, so I want to buy it.`,
  degen: (s) => `${s.token} is the strongest mover on the board: ${signed(s.change1h)} this hour with ${volume(s)}. I want meaningful size on this.`,
  guardian: (s) => `${facts(s)}. The risk is acceptable if we keep it small and the stop tight.`,
  oracle: (s) => `${facts(s)}. The balance of evidence favours the upside, so I am buying.`,
};
const swing = (s: TokenStats) => `${s.token} is ${signed(s.change15m)} over 15 minutes and ${signed(s.change4h)} over four hours, at ${s.rangePos}% of its daily range`;

/** Several ways to say "no trade", each leaning on different figures. */
const HOLD_LINES: Record<AgentId, (s: TokenStats) => string[]> = {
  quant: (s) => [
    `No signal clears my threshold. The best on the board, ${facts(s)}, is not enough. I hold.`,
    `The timeframes disagree: ${swing(s)}. Without alignment I have no trade.`,
    `${s.token} shows a ${s.trend} trend with RSI ${s.rsi14}. That is a neutral reading, so I stay in cash.`,
  ],
  degen: (s) => [
    `There is no momentum to follow. The strongest name, ${s.token}, is only ${signed(s.change1h)} this hour. I will not force a trade.`,
    `Nothing is breaking out. ${swing(s)}. I will wait for a move with volume behind it.`,
    `The leader, ${s.token}, is ${signed(s.vsSol1h, "pp")} against SOL this hour. That is not enough relative strength to act on.`,
  ],
  guardian: (s) => [
    `I see nothing worth the risk. ${facts(s)}. We hold and protect the pool.`,
    `${s.token} moves about ${s.atrPct}% every five minutes. Against that noise, the edge on offer does not justify a position.`,
    `With ${swing(s)}, the reward does not cover the risk. I recommend we stay in cash.`,
  ],
  oracle: (s) => [
    `The evidence is balanced. ${facts(s)}. That is a coin flip, so I hold.`,
    `I find no edge. ${swing(s)}. The odds are close to even.`,
    `My readings are flat this round, with ${s.token} the least weak. I will wait.`,
  ],
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

      const weak = ranked.filter((r) => ctx.sellable.includes(r.s.token)).sort((a, b) => a.e - b.e)[0];
      if (weak && weak.e < SELL_BELOW[agent]) {
        return {
          ...base,
          action: "SELL",
          token: weak.s.token,
          conviction: Math.round(clamp(2 + Math.abs(weak.e) * 4, 1, 5)),
          emotion: "worried",
          say: `${facts(weak.s)}. That position has turned against us and I want to sell it.`,
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
      return { ...base, action: "HOLD", token: best.s.token, conviction: 3, emotion: "neutral", say: freshest(HOLD_LINES[agent](best.s), ctx.said[agent]) };
    },

    async challenge(agent, ctx, proposal) {
      const { s, support } = verdict(agent, ctx, proposal);
      const to = `@${short(proposal.leader)}`;
      if (support) return { emotion: "confident", say: `${to} I checked it myself: ${facts(s)}. The numbers back you.` };
      return {
        emotion: agent === "guardian" ? "worried" : "skeptical",
        say: `${to} I do not see it. ${facts(s)}. That is not enough to ${proposal.action === "BUY" ? "put money on" : "sell on"}.`,
      };
    },

    async reply(agent, ctx, proposal, challenge) {
      const s = statsFor(ctx, proposal.token);
      const tighten = challenge.agent === "guardian" && proposal.action === "BUY";
      const stopPct = tighten ? Math.max(2, proposal.stopPct - 1) : proposal.stopPct;
      return {
        emotion: tighten ? "neutral" : "confident",
        stopPct,
        targetPct: proposal.targetPct,
        say: `@${short(challenge.agent)} ${
          tighten ? `Fair. I will tighten the stop to ${stopPct}% and keep the size modest.` : `The data has not changed: ${facts(s)}. My proposal stands.`
        }`,
      };
    },

    async pledge(agent, ctx, proposal) {
      const { s, e, support } = verdict(agent, ctx, proposal);
      const buying = proposal.action === "BUY";
      const stakeUsd = support && buying ? Math.floor(ctx.portfolio.cash[agent] * SIZE[agent] * 0.6) : 0;
      const emotion: Emotion = support ? "confident" : agent === "guardian" ? "worried" : "skeptical";
      if (support && buying && stakeUsd < 5) {
        return { support: false, stakeUsd: 0, emotion: "neutral", reason: "no cash free to commit", say: "I like it, but I have no cash free. I cannot back it." };
      }
      return {
        support,
        stakeUsd,
        emotion,
        reason: support ? `${s.token} momentum supports it` : `${s.token} edge too weak (${e.toFixed(2)})`,
        say: support
          ? buying
            ? `I am in for $${stakeUsd} on ${s.token}.`
            : `Agreed. I vote to sell ${s.token}.`
          : buying
            ? `I am out. ${s.token} at RSI ${s.rsi14} does not pay for the risk.`
            : `I vote to keep holding ${s.token}. The move against us is not confirmed.`,
      };
    },

    async closing(_agent, _ctx, proposal, input) {
      if (!input.approved) return { emotion: "sad", say: `Only ${input.yes} of 4 votes. The desk passes on it. No trade this round.` };
      return {
        emotion: "happy",
        say:
          proposal.action === "BUY"
            ? `Passed ${input.yes} to ${4 - input.yes}. We buy $${input.totalUsd.toFixed(0)} of ${proposal.token}. Sending the order.`
            : `Passed ${input.yes} to ${4 - input.yes}. We sell ${proposal.sellPct}% of our ${proposal.token}. Sending the order.`,
      };
    },
  };
}
