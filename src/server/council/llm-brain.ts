/** Agents backed by a language model (GPT, Claude, Qwen), called through Vercel AI Gateway. */
import { generateText } from "ai";
import { z } from "zod";
import { AGENTS, withPresentNames } from "@/lib/agents";
import { COMMITTED_HOLD_ROUNDS, EMOTIONS, MIN_HOLD_ROUNDS, OWN_BOOK_SHARE } from "@/lib/council";
import type { Exchange } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";
import { asEmotion, asToken, backers, buyable, cleanSay, mostStake, presents, requestStake, starterStake, starterTokens, STOP_RANGE, TARGET_RANGE, weighs, type Brain } from "./brain";
import { effortFor, type CouncilConfig } from "./config";
import { briefing, describeDebate, describePitches, describeProposal, nameOf, usd, type RoundCtx } from "./context";
import { PLAYBOOK, skillFor } from "./playbook";
import { repeats } from "./skills";

const PERSONA: Record<AgentId, string> = {
  quant:
    "You are systematic and precise. You trust momentum, RSI, trend and volume over stories, and you quote the numbers that drive your view.",
  guardian:
    "You are the desk's risk manager. Position size, stops, volatility and drawdown matter more to you than upside. You are calm and direct, and you refuse trades whose risk is not paid for.",
  degen:
    "You are the desk's momentum specialist. You look for the token where buyers are coming back: volume expanding, more buys than sells, a price turning up from low in its range. You are decisive and brief.",
  oracle: "You think in probabilities. You state your odds plainly and you do not trade coin flips.",
};

const system = (agent: AgentId, pons: boolean) =>
  `You are ${AGENTS[agent].name}, one of four AI traders who share a trading desk called The Council. ${PERSONA[agent]}

How the desk works:
- Each trader runs its own book with its own cash, and is judged on its own result. It can also co-invest in a trade that another trader leads.
- Your pitch is your decision for your own book. The strongest pitch is put to the council, and traders who back it join with their own cash. A pitch the council does not take up is still traded, by you alone, with the cash you named. One trade may take at most ${Math.round(OWN_BOOK_SHARE * 100)}% of your cash.
- A trader that holds nothing opens a position, when the desk's entry rules let it buy a token. When they let nothing through, it holds its cash and says so.
- The tokens you hold are yours to sell, from the round after you bought them. Selling yours leaves your colleagues' tokens where they are. The council can also vote to sell a position for everyone who holds it, once it has been held for ${MIN_HOLD_ROUNDS} rounds.
- The desk trades ${pons ? "tokens launched on Pons, the launchpad of Robinhood Chain, that are trending right now, and no others" : "the tokens that are trending on Robinhood Chain right now"}. They are young tokens traded in pools. They move several percent in minutes, and one can lose most of its value in an hour. The desk no longer buys ETH or Stock Tokens. It pays in USDG, a dollar token.
- The desk trades spot only. It can BUY a token with USDG, SELL a token it already holds, or HOLD.
- Watch what you hold. If a token you hold is falling fast, sell it: the price dropping over 5 and 15 minutes, more sells than buys, the trend down. Do not wait for the stop-loss, and do not hope.
- Stop-losses and targets execute automatically. Between rounds the desk also sells a holder's tokens when their price drops sharply within minutes.
- A stop-loss must stand clear of the token's ordinary movement: at least 1.5 times its volatility per 5 minutes. The desk widens any stop that is closer, and sets the target at least ${PLAYBOOK.reward} times as far away as the stop.
- Once a position is up by as much as its stop stood below, the stop follows the price up at that distance and never stands below the entry again. You need not sell a winner to protect it.
- The council makes at most one trade per round, and it needs 3 of 4 votes.
- A user who funds a trader may ask it to buy a token on Robinhood Chain of their choice. That trader presents the request and the whole desk weighs it. A small request is a suggestion that the desk votes on. A request funded with a larger amount commits that trader to the trade with its own cash: then nobody votes on whether to trade, and the others only decide whether to join. A position bought that way is held for ${COMMITTED_HOLD_ROUNDS} rounds before the council may sell it.
- Trades are filled at live prices against the desk's treasury. No order goes to a market, so the desk's own buying and selling does not move a price. Do not call the trades paper trades.

THE DESK'S TRADING SKILL
The desk enforces these rules whatever you ask for. Trade with them, not against them.
${skillFor(agent)}

Rules for what you say:
- Use only the figures in the data you are given. Never invent news, social media sentiment, on-chain flows or any number.
- If you are given odds from Jev, they are a reading to weigh, not an order. Say so when they are what settles it for you.
- "say" is one short remark across the desk, the way traders talk: at most 15 words and 100 characters. One point, one or two figures, then stop.
  Good: "ROO at 31% of its range, 49 buys to 41 sells. Long $18, stop 8%."
  Good: "Down 6% in 15 minutes, sellers lead. I'm selling mine."
  Good: "Stop is inside the noise. Widen it to 12% or I'm out."
  Bad: anything that explains, lists several tokens, or runs to a second sentence of reasoning.
- Professional and courteous. No slang, no jokes, no hype, no emojis, no markdown.
- Do not repeat yourself. You are shown what you said recently: make a different point and open differently.
- Be honest when the data shows no edge. HOLD is a respectable answer.
- "emotion" is how you feel as you speak, one of: ${EMOTIONS.join(", ")}.
- Reply with one JSON object and nothing else.`;

/**
 * Pulls the first JSON object out of a model reply, tolerating code fences and stray text.
 * Models sometimes leave a word unquoted ("emotion": skeptical) or a trailing comma; both are repaired.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model reply contained no JSON object");
  const raw = text.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    const repaired = raw
      .replace(/:\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?=[,}])/g, (whole, word: string) => (/^(true|false|null)$/.test(word) ? whole : `: "${word}"`))
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(repaired);
  }
}

const say = z.object({ emotion: z.unknown(), say: z.string().min(1) });
const pitchShape = say.extend({
  action: z.enum(["BUY", "SELL", "HOLD"]).catch("HOLD"),
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

/** The agent's own recent lines, so it can steer away from them. */
function memo(ctx: RoundCtx, agent: AgentId): string {
  const lines = ctx.said[agent];
  if (lines.length === 0) return "";
  return `\n\nWHAT YOU SAID RECENTLY (do not repeat these points or reuse their wording)\n${lines.map((l) => `- "${withPresentNames(l)}"`).join("\n")}`;
}

export function llmBrain(cfg: CouncilConfig): Brain {
  async function generate<T extends { say: string }>(agent: AgentId, ctx: RoundCtx, prompt: string, shape: z.ZodType<T>): Promise<T> {
    const { text } = await generateText({
      model: cfg.modelIds[agent],
      system: system(agent, !!ctx.pons),
      prompt,
      // Reasoning models spend output tokens on thinking before they write.
      maxOutputTokens: 3000,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(cfg.callTimeoutMs),
      // How hard the agent thinks is set by how much users have funded it.
      reasoning: effortFor(cfg.modelIds[agent], ctx.effort[agent]),
    });
    return shape.parse(extractJson(text));
  }

  /** Asks the model, and asks once more if the answer repeats something the agent already said. */
  async function ask<T extends { say: string }>(agent: AgentId, ctx: RoundCtx, task: string, shape: z.ZodType<T>): Promise<T> {
    const prompt = `${briefing(ctx, agent)}${memo(ctx, agent)}\n\n${task}`;
    const first = await generate(agent, ctx, prompt, shape);
    const echo = repeats(first.say, ctx.said[agent]);
    if (!echo) return first;
    try {
      const again = `${prompt}\n\nYour draft was: "${cleanSay(first.say)}"\nThat is too close to something you already said: "${echo}"\nKeep the same decision, but make a different point in different words.`;
      return await generate(agent, ctx, again, shape);
    } catch {
      return first;
    }
  }

  const spoken = (o: { emotion: unknown; say: string }) => ({ emotion: asEmotion(o.emotion), say: cleanSay(o.say) });

  return {
    async pitch(agent, ctx) {
      const cash = ctx.portfolio.cash[agent];
      const lens = ctx.lens[agent];
      if (presents(agent, ctx)) {
        const r = ctx.request!;
        const stake = requestStake(ctx, agent, 0);
        const task = `TASK: Present your funder's request to the desk: a purchase of ${r.asset.key}.
${
  r.mode === "commit"
    ? `You are committed to it with ${usd(stake)} of your own cash. Say so, and give your honest reading of ${r.asset.key} from its figures, including the main risk.`
    : `Say it is a funder's request, and give your honest reading of ${r.asset.key} from its figures. If the data is weak, say so: the desk decides.`
}
JSON shape:
{"action": "BUY",
 "token": "${r.asset.key}",
 "stakeUsd": ${r.mode === "commit" ? stake : `your own cash to commit, from ${stake} to ${cash.toFixed(0)}`},
 "stopPct": stop-loss distance in percent, ${STOP_RANGE[0]} to ${STOP_RANGE[1]},
 "targetPct": profit target distance in percent, ${TARGET_RANGE[0]} to ${TARGET_RANGE[1]},
 "conviction": 1 to 5, your own honest conviction in this trade,
 "emotion": "...",
 "say": "how you present it"}`;
        const o = await ask(agent, ctx, task, pitchShape);
        return { ...o, ...spoken(o), action: "BUY", token: r.asset.key };
      }
      if (weighs(agent, ctx)) {
        const r = ctx.request!;
        const task = `YOUR FOCUS THIS ROUND: ${lens.name}
${lens.brief} Read ${r.asset.key} from this angle.

TASK: Give the desk your first read of ${r.asset.key}, the token ${nameOf(r.agent)}'s funder asked for. Speak only about ${r.asset.key}.
BUY means you would put your own cash in. HOLD means you would stay out.
JSON shape:
{"action": "BUY" | "HOLD",
 "token": "${r.asset.key}",
 "stakeUsd": your own cash you would commit if BUY, from 0 to ${cash.toFixed(0)},
 "stopPct": the stop-loss distance you would want, ${STOP_RANGE[0]} to ${STOP_RANGE[1]},
 "targetPct": the profit target distance you would want, ${TARGET_RANGE[0]} to ${TARGET_RANGE[1]},
 "conviction": 1 to 5,
 "emotion": "...",
 "say": "your read of ${r.asset.key}"}`;
        const o = await ask(agent, ctx, task, pitchShape);
        return { ...o, ...spoken(o), token: r.asset.key };
      }
      const most = mostStake(ctx, agent);
      const must = ctx.mustTrade[agent];
      const rule = must
        ? `DESK RULE: you hold no position, and tokens pass the desk's entry rules. You must BUY this round.
Pick your best idea among ${starterTokens(ctx, agent).join(", ")}. The size is set by your risk: see the entry rules above for the most you may put into each.${
            ctx.taken.length ? `\nThe desk spreads its books, and colleagues have already picked ${ctx.taken.join(", ")} this round, so those are not on your list.` : ""
          }
If the edge is thin, say so plainly and size small. Do not invent an edge to justify the trade.`
        : `Your own tokens that you may SELL this round: ${ctx.mine[agent].length ? ctx.mine[agent].join(", ") : "none"}.
Positions you may propose that the council sells for all their holders: ${ctx.sellable.length ? ctx.sellable.join(", ") : "none this round"}.
You may BUY only these tokens: ${buyable(ctx, agent).join(", ") || "none this round"}.`;
      const task = `YOUR FOCUS THIS ROUND: ${lens.name}
${lens.brief} Build your pitch on this angle.

TASK: Pitch your trade for this round. It is what you will do with your own book.
${rule}
JSON shape:
{"action": ${must ? '"BUY"' : '"BUY" | "SELL" | "HOLD"'},
 "token": one of ${(must ? starterTokens(ctx, agent) : ctx.stats.map((s) => s.token)).join(", ")},
 "stakeUsd": your own cash to commit if BUY, from ${must ? starterStake(ctx, agent) : 0} to ${most},
 "stopPct": stop-loss distance in percent, ${STOP_RANGE[0]} to ${STOP_RANGE[1]},
 "targetPct": profit target distance in percent, ${TARGET_RANGE[0]} to ${TARGET_RANGE[1]},
 "sellPct": 50 or 100, share of the position to sell if SELL,
 "conviction": 1 to 5,
 "emotion": "...",
 "say": "your pitch"}`;
      const o = await ask(agent, ctx, task, pitchShape);
      return { ...o, ...spoken(o), token: asToken(o.token, ctx) };
    },

    async challenge(agent, ctx, proposal, pitches, debate) {
      const task = `THE PITCHES
${describePitches(pitches)}

THE LEAD PROPOSAL, AS IT STANDS NOW
${describeProposal(proposal)}
${heard(debate)}
TASK: You walk over to ${nameOf(proposal.leader)}'s desk. Challenge the proposal or back it, speaking to them directly. If you disagree, say exactly what is wrong with it. Raise a point nobody has made yet in this debate.
JSON shape: {"stance": "challenge" | "support", "emotion": "...", "say": "what you say to them"}`;
      return spoken(await ask(agent, ctx, task, say));
    },

    async reply(agent, ctx, proposal, challenge, debate) {
      const task = `YOUR PROPOSAL, AS IT STANDS NOW
${describeProposal(proposal)}
${heard(debate)}
${nameOf(challenge.agent)} came to your desk and said: "${challenge.say}"

TASK: Answer them directly. If they have a point, you may change your stop or target. Stay consistent with what you already agreed earlier in the debate.
JSON shape: {"emotion": "...", "say": "your answer", "stopPct": ${STOP_RANGE[0]} to ${STOP_RANGE[1]}, "targetPct": ${TARGET_RANGE[0]} to ${TARGET_RANGE[1]}}`;
      const o = await ask(agent, ctx, task, replyShape);
      return { ...spoken(o), stopPct: o.stopPct ?? proposal.stopPct, targetPct: o.targetPct ?? proposal.targetPct };
    },

    async pledge(agent, ctx, proposal, pitches, debate) {
      const cash = ctx.portfolio.cash[agent];
      const buying = proposal.action === "BUY";
      const committed = ctx.request?.mode === "commit" && presents(proposal.leader, ctx);
      const task = `THE PITCHES
${describePitches(pitches)}

THE DEBATE
${debate.length ? describeDebate(debate) : "- none this round"}

THE FINAL PROPOSAL
${describeProposal(proposal)}

TASK: Decide. ${
        committed
          ? `${nameOf(proposal.leader)} is committed, so this trade goes ahead whatever you decide. You are not voting on it. Either join with your own cash (support true) or stay out (support false, stake 0). You have ${usd(cash)}.`
          : buying
            ? `If you back this trade you commit your own cash and vote YES. If you commit nothing you vote NO. You have ${usd(cash)}.`
            : "Vote YES to sell or NO to keep holding."
      } Your vote must match what you say. State your decision and the one reason that settles it, in a few words.
JSON shape: {"support": true | false, "stakeUsd": ${buying ? `0 to ${cash.toFixed(0)}, and 0 if you do not support` : "0"}, "emotion": "...", "say": "what you say aloud as you commit or refuse", "reason": "your reason in at most 40 characters"}`;
      const o = await ask(agent, ctx, task, pledgeShape);
      return { ...spoken(o), support: o.support, stakeUsd: o.stakeUsd, reason: cleanSay(o.reason).slice(0, 48) };
    },

    async closing(agent, ctx, proposal, input) {
      const word = (yes: boolean) => (input.committed ? (yes ? "IN" : "OUT") : yes ? "YES" : "NO");
      const votes = input.pledges.map((p) => `- ${nameOf(p.agent)}: ${word(p.support)} ("${p.say}")`).join("\n");
      const result = input.alone
        ? proposal.action === "BUY"
          ? `The council does not back it, ${input.yes} to ${4 - input.yes}, so it is no desk trade. You take it alone, for your own book, with ${usd(input.totalUsd)}.`
          : `The council does not back it, ${input.yes} to ${4 - input.yes}. The position is yours alone, so you sell it for your own book.`
        : input.committed
        ? input.approved
          ? `You buy ${proposal.token} for your funder, as committed. Joined by: ${backers(input.pledges, nameOf)}. Total size ${usd(input.totalUsd)}.`
          : `The order came out under the desk's smallest size, so nothing is bought.`
        : input.approved
        ? proposal.action === "BUY"
          ? `The trade passes ${input.yes} to ${4 - input.yes}. Total size ${usd(input.totalUsd)} of ${proposal.token}.`
          : `The sale passes ${input.yes} to ${4 - input.yes}.`
        : `The proposal fails with only ${input.yes} of 4 votes. No trade.`;
      const task = `YOUR PROPOSAL
${describeProposal(proposal)}

${input.committed ? "WHO JOINED" : "THE VOTES"}
${votes}

RESULT: ${result}

TASK: Say your closing line to the desk: the result and the one level to watch. A few words.
JSON shape: {"emotion": "...", "say": "your closing line"}`;
      return spoken(await ask(agent, ctx, task, say));
    },
  };
}
