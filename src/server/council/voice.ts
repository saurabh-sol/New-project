/**
 * An agent whose brain is the evaluation model and who has a language model of its own.
 * The evaluation model decides: what to trade, how much, the stop, the vote. The agent's own
 * model is handed that decision with the odds behind it, and says it in the agent's words.
 * It cannot change the decision. If it can't be reached, or names a figure it was not given,
 * the line stands as the evaluation model's template wrote it.
 */
import { generateText } from "ai";
import { z } from "zod";
import { AGENTS, withPresentNames } from "@/lib/agents";
import type { AgentId } from "@/lib/types";
import { cleanSay, enforcePitch, presents, weighs, type Brain } from "./brain";
import { effortFor, type CouncilConfig } from "./config";
import { describeProposal, describeRequest, marketTable, nameOf, type RoundCtx } from "./context";
import { extractJson, PERSONA } from "./llm-brain";
import { skillFor } from "./playbook";
import { repeats } from "./skills";

/** Wording a line is quick work. A speaker that takes longer is not waited for. */
const VOICE_TIMEOUT_MS = 20_000;

const system = (agent: AgentId) =>
  `You are ${AGENTS[agent].name}, one of four AI traders who share a trading desk called The Council. ${PERSONA[agent]}

Your trading decisions are made from the odds of an evaluation model that reads the same market figures you are shown. Each time, you are given the decision and the odds behind it, and a plain line that states them. You say it to the desk, as yourself.

Rules for what you say:
- The decision is made. Do not change it, soften it or argue with it: the same action, the same token, the same amounts, the same stop and target, the same vote.
- The odds are the reason for the decision. Where the line as it stands states odds, your line states them too, as the reason. Do not give another reason in their place.
- You may add one figure from the market data that bears on the decision, read from your focus this round.
- Use only figures from the decision and the market data you are given, exactly as they are given. Never invent news, social media sentiment, on-chain flows or any number.
- One short remark across the desk, the way traders talk: at most 15 words and 100 characters. One point, one or two figures, then stop. It is a remark, not a list of terms: leave out the stop, the target and the conviction unless the line as it stands names them.
  Good: "ROO: 61% odds it is higher in four hours, buyers 12 to 5. Long $18."
  Good: "Only 38% to reach target first. None of my cash."
  Bad: "Buy ROO $18; stop 8% below; target 16% above; conviction 4/5."
  Bad: "ROO is low in its range with volume rising. Long." (the odds are missing)
- Professional and courteous. No slang, no jokes, no hype, no emojis, no markdown.
- Do not repeat yourself. You are shown what you said recently: open differently.
- Do not call the trades paper trades.
- Reply with one JSON object and nothing else: {"say": "your line"}

THE DESK'S TRADING SKILL
The desk has already applied these rules to the decision. They are here so that you speak as a trader who keeps them.
${skillFor(agent)}`;

const shape = z.object({ say: z.string().min(1) });

const amounts = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => Number(m[1].replace(/,/g, "")));
const dollars = (text: string) => amounts(text, /\$(\d+(?:,\d{3})*(?:\.\d+)?)/g);
const percents = (text: string) => amounts(text, /(\d+(?:\.\d+)?)%/g);

/** A dollar amount or a percentage in the line that the speaker was not given, if there is one. */
function invented(line: string, given: string): string | null {
  const known$ = dollars(given);
  const bad$ = dollars(line).find((n) => !known$.some((k) => Math.abs(k - n) < 0.005));
  if (bad$ !== undefined) return `$${bad$}`;
  // A percentage may be rounded to the whole number.
  const known = percents(given);
  const bad = percents(line).find((n) => !known.some((k) => Math.abs(k - n) <= 0.5));
  return bad === undefined ? null : `${bad}%`;
}

export function voicedBrain(decider: Brain, cfg: CouncilConfig): Brain {
  /** The decided line, in the agent's own words. The line as it stood, if its model fails or strays. */
  async function voice(agent: AgentId, ctx: RoundCtx, situation: string, decided: string, draft: string): Promise<string> {
    const lens = ctx.lens[agent];
    const recent = ctx.said[agent];
    const prompt = [
      `ROUND ${ctx.round}`,
      "",
      "MARKET (live prices in USD)",
      marketTable(ctx.stats),
      "",
      `YOUR FOCUS THIS ROUND: ${lens.name}`,
      lens.brief,
      "",
      situation,
      "",
      "WHAT YOU DECIDED",
      decided,
      "",
      "THE LINE AS IT STANDS",
      `"${draft}"`,
      ...(recent.length ? ["", "WHAT YOU SAID RECENTLY (do not reuse their wording)", ...recent.map((l) => `- "${withPresentNames(l)}"`)] : []),
      "",
      "TASK: Say the line in your own words. The decision and its figures stay as they are.",
      'JSON shape: {"say": "your line"}',
    ].join("\n");
    try {
      const { text } = await generateText({
        model: cfg.modelIds[agent],
        system: system(agent),
        prompt,
        maxOutputTokens: 1500,
        maxRetries: 1,
        abortSignal: AbortSignal.timeout(Math.min(cfg.callTimeoutMs, VOICE_TIMEOUT_MS)),
        reasoning: effortFor(cfg.modelIds[agent], "low"),
      });
      const said = cleanSay(shape.parse(extractJson(text)).say);
      const stray = invented(said, prompt);
      if (stray) {
        console.error(`[council] ${cfg.modelIds[agent]} named ${stray}, which ${agent} was not given. The line stands as decided.`);
        return draft;
      }
      // The odds are why the agent does what it does. A line that leaves them out gives some other reason.
      const odds = percents(draft);
      if (odds.length && !percents(said).some((n) => odds.includes(n))) {
        console.error(`[council] ${cfg.modelIds[agent]} left out the odds ${agent} decided on. The line stands as decided.`);
        return draft;
      }
      // The template line was chosen to be unlike what the agent said before.
      return repeats(said, recent) ? draft : said;
    } catch (e) {
      console.error(`[council] ${cfg.modelIds[agent]} could not word ${agent}'s line, which stands as decided:`, e instanceof Error ? e.message.split("\n")[0] : e);
      return draft;
    }
  }

  const floor = (ctx: RoundCtx) => (ctx.request ? `A FUNDER'S REQUEST THIS ROUND\n${describeRequest(ctx)}` : "No funder's request this round. Every trader pitches a trade for its own book.");

  return {
    async pitch(agent, ctx) {
      // The desk's rules are applied first, so that the agent speaks of the trade it will get.
      const p = enforcePitch(agent, ctx, await decider.pitch(agent, ctx));
      const t = p.token;
      const decided = presents(agent, ctx)
        ? `You present your funder's request: BUY ${t}, with $${p.stakeUsd} of your own cash, stop-loss ${p.stopPct}% below, target ${p.targetPct}% above. ${ctx.request!.mode === "commit" ? "You are committed to it." : "The desk votes on it."} Conviction ${p.conviction} of 5.`
        : weighs(agent, ctx)
          ? p.action === "BUY"
            ? `Your first read of ${t}, the token ${nameOf(ctx.request!.agent)}'s funder asked for: you would join, with $${p.stakeUsd} of your own cash. Conviction ${p.conviction} of 5.`
            : `Your first read of ${t}, the token ${nameOf(ctx.request!.agent)}'s funder asked for: you would stay out.`
          : p.action === "BUY"
            ? `Your pitch: BUY ${t} with $${p.stakeUsd} of your own cash, stop-loss ${p.stopPct}% below, target ${p.targetPct}% above. Conviction ${p.conviction} of 5.`
            : p.action === "SELL"
              ? `Your pitch: SELL ${p.sellPct}% of your ${t}. Conviction ${p.conviction} of 5.`
              : "Your pitch: HOLD. No trade from you this round.";
      return { ...p, say: await voice(agent, ctx, floor(ctx), decided, p.say) };
    },

    async challenge(agent, ctx, proposal, pitches, debate) {
      const c = await decider.challenge(agent, ctx, proposal, pitches, debate);
      const situation = `THE LEAD PROPOSAL\n${describeProposal(proposal)}\nYou walk over to ${nameOf(proposal.leader)}'s desk and speak to them directly.`;
      return { ...c, say: await voice(agent, ctx, situation, "Whether you back the proposal or doubt it, and on what odds, is in the line below.", c.say) };
    },

    async reply(agent, ctx, proposal, challenge, debate) {
      const r = await decider.reply(agent, ctx, proposal, challenge, debate);
      const situation = `YOUR PROPOSAL\n${describeProposal(proposal)}\n${nameOf(challenge.agent)} came to your desk and said: "${challenge.say}"\nYou answer them directly.`;
      const moved = r.stopPct !== proposal.stopPct || r.targetPct !== proposal.targetPct;
      const decided = moved ? `You give way: the stop-loss is now ${r.stopPct}% and the target ${r.targetPct}%.` : "Your terms stand as they are.";
      return { ...r, say: await voice(agent, ctx, situation, decided, r.say) };
    },

    async pledge(agent, ctx, proposal, pitches, debate) {
      const p = await decider.pledge(agent, ctx, proposal, pitches, debate);
      const committed = ctx.request?.mode === "commit" && presents(proposal.leader, ctx);
      const situation = `THE FINAL PROPOSAL\n${describeProposal(proposal)}\n${committed ? `${nameOf(proposal.leader)} is committed, so the trade goes ahead. You only choose whether to join.` : "You vote with your cash."}`;
      const decided =
        proposal.action === "BUY"
          ? p.support
            ? `You ${committed ? "join" : "vote YES"}, with $${p.stakeUsd} of your own cash.`
            : `You ${committed ? "stay out" : "vote NO"}. None of your cash goes in.`
          : p.support
            ? "You vote YES to the sale."
            : "You vote NO. You keep holding.";
      return { ...p, say: await voice(agent, ctx, situation, decided, p.say) };
    },

    async closing(agent, ctx, proposal, input) {
      const c = await decider.closing(agent, ctx, proposal, input);
      const situation = `YOUR PROPOSAL\n${describeProposal(proposal)}\nThe desk has decided. You say your closing line.`;
      return { ...c, say: await voice(agent, ctx, situation, "The result is in the line below. State it as it is.", c.say) };
    },
  };
}
