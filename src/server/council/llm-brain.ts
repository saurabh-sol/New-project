/** Agents backed by a language model (GPT, Claude, Grok), called through Vercel AI Gateway. */
import { generateText } from "ai";
import { z } from "zod";
import { AGENTS } from "@/lib/agents";
import { EMOTIONS, MIN_HOLD_ROUNDS } from "@/lib/council";
import type { Exchange } from "@/lib/council-types";
import { TOKENS } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { asEmotion, asToken, cleanSay, STOP_RANGE, TARGET_RANGE, type Brain } from "./brain";
import type { CouncilConfig } from "./config";
import { briefing, describeDebate, describePitches, describeProposal, nameOf, usd } from "./context";

const PERSONA: Record<AgentId, string> = {
  quant:
    "You are systematic and precise. You trust momentum, RSI and volume over stories, and you quote the numbers that drive your view.",
  guardian:
    "You are the desk's risk manager. Position size, stops and drawdown matter more to you than upside. You are calm and direct, and you refuse trades whose risk is not paid for.",
  degen:
    "You are the aggressive momentum trader. You like the biggest movers and volume spikes, and you size up when you see them. You are blunt, funny and impatient, but you do not argue with the numbers.",
  oracle: "You think in probabilities. You state your odds plainly and you do not trade coin flips.",
};

const system = (agent: AgentId) =>
  `You are ${AGENTS[agent].name}, one of four AI traders who share a trading desk called The Council. ${PERSONA[agent]}

How the desk works:
- Each trader manages its own cash and can co-invest in a trade that another trader leads.
- The desk trades spot only. It can BUY a token with USDC, SELL a token it already holds, or HOLD.
- A position must be held for at least ${MIN_HOLD_ROUNDS} rounds before the council may sell it. Stop-losses and targets execute automatically.
- The council makes at most one trade per round, and it needs 3 of 4 votes.
- This is paper trading on live prices.

Rules for what you say:
- Use only the figures in the data you are given. Never invent news, social media sentiment, on-chain flows or any number.
- "say" is spoken aloud to your colleagues: plain conversational English, one or two sentences, at most 200 characters, no emojis, no markdown.
- Stay in character, and be honest when the data shows no edge. HOLD is a respectable answer.
- "emotion" is how you feel as you speak, one of: ${EMOTIONS.join(", ")}.
- Reply with one JSON object and nothing else.`;

/** Pulls the first JSON object out of a model reply, tolerating code fences and stray text. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model reply contained no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

const say = z.object({ emotion: z.unknown(), say: z.string().min(1) });
const pitchShape = say.extend({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  token: z.unknown(),
  stakeUsd: z.coerce.number().catch(0),
  stopPct: z.coerce.number().catch(4),
  targetPct: z.coerce.number().catch(8),
  sellPct: z.coerce.number().catch(100),
  conviction: z.coerce.number().catch(3),
});
const replyShape = say.extend({ stopPct: z.coerce.number().optional().catch(undefined), targetPct: z.coerce.number().optional().catch(undefined) });
const pledgeShape = say.extend({ support: z.boolean(), stakeUsd: z.coerce.number().catch(0), reason: z.string().catch("") });

const heard = (debate: Exchange[]) => (debate.length ? `\nALREADY SAID IN THIS DEBATE\n${describeDebate(debate)}\n` : "");

export function llmBrain(cfg: CouncilConfig): Brain {
  async function ask<T>(agent: AgentId, task: string, shape: z.ZodType<T>, ctxText: string): Promise<T> {
    const { text } = await generateText({
      model: cfg.modelIds[agent],
      system: system(agent),
      prompt: `${ctxText}\n\n${task}`,
      // Reasoning models spend output tokens on thinking before they write.
      maxOutputTokens: 2000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(cfg.callTimeoutMs),
      providerOptions: { openai: { reasoningEffort: "low" } },
    });
    return shape.parse(extractJson(text));
  }

  const spoken = (o: { emotion: unknown; say: string }) => ({ emotion: asEmotion(o.emotion), say: cleanSay(o.say) });

  return {
    async pitch(agent, ctx) {
      const cash = ctx.portfolio.cash[agent];
      const task = `TASK: Pitch your trade for this round.
You may SELL only these tokens: ${ctx.sellable.length ? ctx.sellable.join(", ") : "none this round"}.
JSON shape:
{"action": "BUY" | "SELL" | "HOLD",
 "token": one of ${TOKENS.join(", ")},
 "stakeUsd": your own cash to commit if BUY, from 0 to ${cash.toFixed(0)},
 "stopPct": stop-loss distance in percent, ${STOP_RANGE[0]} to ${STOP_RANGE[1]},
 "targetPct": profit target distance in percent, ${TARGET_RANGE[0]} to ${TARGET_RANGE[1]},
 "sellPct": 50 or 100, share of the position to sell if SELL,
 "conviction": 1 to 5,
 "emotion": "...",
 "say": "your pitch"}`;
      const o = await ask(agent, task, pitchShape, briefing(ctx, agent));
      return { ...o, ...spoken(o), token: asToken(o.token, ctx.stats[0].token) };
    },

    async challenge(agent, ctx, proposal, pitches, debate) {
      const task = `THE PITCHES
${describePitches(pitches)}

THE LEAD PROPOSAL, AS IT STANDS NOW
${describeProposal(proposal)}
${heard(debate)}
TASK: You walk over to ${nameOf(proposal.leader)}'s desk. Challenge the proposal or back it, speaking to them directly. If you disagree, say exactly what is wrong with it.
JSON shape: {"stance": "challenge" | "support", "emotion": "...", "say": "what you say to them"}`;
      return spoken(await ask(agent, task, say, briefing(ctx, agent)));
    },

    async reply(agent, ctx, proposal, challenge, debate) {
      const task = `YOUR PROPOSAL, AS IT STANDS NOW
${describeProposal(proposal)}
${heard(debate)}
${nameOf(challenge.agent)} came to your desk and said: "${challenge.say}"

TASK: Answer them directly. If they have a point, you may change your stop or target. Stay consistent with what you already agreed earlier in the debate.
JSON shape: {"emotion": "...", "say": "your answer", "stopPct": ${STOP_RANGE[0]} to ${STOP_RANGE[1]}, "targetPct": ${TARGET_RANGE[0]} to ${TARGET_RANGE[1]}}`;
      const o = await ask(agent, task, replyShape, briefing(ctx, agent));
      return { ...spoken(o), stopPct: o.stopPct ?? proposal.stopPct, targetPct: o.targetPct ?? proposal.targetPct };
    },

    async pledge(agent, ctx, proposal, pitches, debate) {
      const cash = ctx.portfolio.cash[agent];
      const buying = proposal.action === "BUY";
      const task = `THE PITCHES
${describePitches(pitches)}

THE DEBATE
${describeDebate(debate)}

THE FINAL PROPOSAL
${describeProposal(proposal)}

TASK: Decide. ${
        buying
          ? `If you back this trade you commit your own cash and vote YES. If you commit nothing you vote NO. You have ${usd(cash)}.`
          : "Vote YES to sell or NO to keep holding."
      } Your vote must match what you say.
JSON shape: {"support": true | false, "stakeUsd": ${buying ? `0 to ${cash.toFixed(0)}, and 0 if you do not support` : "0"}, "emotion": "...", "say": "what you say aloud as you commit or refuse", "reason": "your reason in at most 60 characters"}`;
      const o = await ask(agent, task, pledgeShape, briefing(ctx, agent));
      return { ...spoken(o), support: o.support, stakeUsd: o.stakeUsd, reason: cleanSay(o.reason).slice(0, 70) };
    },

    async closing(agent, ctx, proposal, input) {
      const votes = input.pledges.map((p) => `- ${nameOf(p.agent)}: ${p.support ? "YES" : "NO"} ("${p.say}")`).join("\n");
      const result = input.approved
        ? proposal.action === "BUY"
          ? `The trade passes ${input.yes} to ${4 - input.yes}. Total size ${usd(input.totalUsd)} of ${proposal.token}.`
          : `The sale passes ${input.yes} to ${4 - input.yes}.`
        : `The proposal fails with only ${input.yes} of 4 votes. No trade.`;
      const task = `YOUR PROPOSAL
${describeProposal(proposal)}

THE VOTES
${votes}

RESULT: ${result}

TASK: Say your closing line to the desk.
JSON shape: {"emotion": "...", "say": "your closing line"}`;
      return spoken(await ask(agent, task, say, briefing(ctx, agent)));
    },
  };
}
