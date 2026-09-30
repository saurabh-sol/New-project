/**
 * Runs one council session: pitches, debate, pledges, vote, order.
 * The models supply opinions; this file decides what is allowed to happen.
 */
import { AGENT_ORDER } from "@/lib/agents";
import type { DeskAsset } from "@/lib/assets";
import { buy, canSell, canSellOwn, COMMITTED_HOLD_ROUNDS, COUNCIL_MAX_USD, fitStakes, invested, OWN_BOOK_SHARE, positionOf, sell, shareOut, SOLO_USD, userFunding, zeroStakes, type Fill, type Portfolio } from "@/lib/council";
import type { CouncilMode, Exchange, Line, OwnTrade, Pitch, Pledge, Proposal, Source, Stage, TokenStats, Vote } from "@/lib/council-types";
import { isToken, type AssetKey, type Prices } from "@/lib/market";
import { moodFor } from "@/lib/mood";
import type { AgentId } from "@/lib/types";
import { backers, clamp, cleanSay, enforcePitch, fitTerms, type Brain } from "./brain";
import { isEvaluationModel, type CouncilConfig } from "./config";
import { nameOf, px, signed, usd, type RoundCtx } from "./context";
import { jevBrain, oddsFromJev } from "./jev-brain";
import { llmBrain } from "./llm-brain";
import { linesAbout, recentLines, saveRound } from "./memory";
import { scriptedBrain } from "./scripted-brain";
import { fundingLevel, pick, pickLens, type Effort, type Skill } from "./skills";
import { settleOnChain } from "../chains/desk";
import { notTradable, realTrading } from "../chains/wallets";
import { liveRequests, type ActiveRequest, type RequestSource } from "../requests/service";
import { assetQuote } from "../market/assets";
import { buyTogether, inRealTurn, priceOf, sellTogether } from "./real";
import { assetStats, fetchBoard, fetchPrice, type Board } from "./stats";
import { readState, updateState, type CouncilState } from "./store";
import { voicedBrain } from "./voice";

const VOTES_TO_PASS = 3;

/** A session in progress. Any number of viewers can follow the same one. */
export class RoundRun {
  readonly stages: Stage[] = [];
  done = false;
  /** Set when the round broke before finishing, so it is not replayed to later viewers. */
  failed = false;
  private waiting: Array<() => void> = [];

  constructor(readonly id: number) {}

  /** A finished session loaded from storage, ready to replay. */
  static replay(id: number, stages: Stage[]): RoundRun {
    const run = new RoundRun(id);
    run.stages.push(...stages);
    run.done = true;
    return run;
  }

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

const budget = globalThis as typeof globalThis & { __councilOutOfBudget?: number };
const noteOutOfBudget = () => (budget.__councilOutOfBudget = Date.now());
/** How long the models are left alone once the gateway has said its budget is used up. Then they are tried again. */
const LEAVE_ALONE_MS = 15 * 60_000;
/** Whether the gateway refused the models for want of budget a short while ago. */
export const outOfBudget = () => Date.now() - (budget.__councilOutOfBudget ?? 0) < LEAVE_ALONE_MS;

/** Runs a call on the agent's model and falls back to the scripted stand-in if it fails. */
function thinker(cfg: CouncilConfig, mode: CouncilMode) {
  const scripted = scriptedBrain();
  const llm = llmBrain(cfg);
  const jev = jevBrain(cfg);
  const voiced = voicedBrain(jev, cfg);
  // An agent whose brain is the evaluation model decides by it. If it has a model of its own that writes, that model words its lines.
  const modelFor = (agent: AgentId): Brain => (!isEvaluationModel(cfg.brainIds[agent]) ? llm : isEvaluationModel(cfg.modelIds[agent]) ? jev : voiced);

  return async function think<T extends object>(agent: AgentId, call: (brain: Brain) => Promise<T>): Promise<Tagged<T>> {
    if (mode === "live") {
      try {
        return { ...(await call(modelFor(agent))), source: "model" };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error(`[council] ${cfg.brainIds[agent]} failed for ${agent}, using scripted stand-in:`, message);
        // Out of budget is not a passing fault: no model will answer until the budget is raised.
        if (/budget exceeded|insufficient (funds|credit)|payment required/i.test(message)) noteOutOfBudget();
      }
    }
    return { ...(await call(scripted)), source: "scripted" };
  };
}

/** The strongest non-HOLD pitch becomes the proposal the council debates. */
function chooseProposal(pitches: Pitch[], sellPct: Record<AgentId, number>, sellable: AssetKey[]): Proposal | null {
  const lead = pitches
    // A sale the council may not make yet is the agent's own business, and is not put to a vote.
    .filter((p) => p.action === "BUY" || (p.action === "SELL" && sellable.includes(p.token)))
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
  /** `desk` is the state the session opened with: what the desk holds and knows. */
  board(desk?: CouncilState): Promise<Board>;
  price(token: AssetKey, assets: Record<AssetKey, DeskAsset>): Promise<number>;
}

const liveMarket: MarketSource = { board: fetchBoard, price: fetchPrice };

const LENS_MEMORY = 6;
const perAgent = <T,>(fn: (a: AgentId) => T) => Object.fromEntries(AGENT_ORDER.map((a) => [a, fn(a)])) as Record<AgentId, T>;

/**
 * Runs the session that `opening` has already claimed (its round number and start
 * time are saved), so no other server starts the same one.
 */
export async function runRound(
  run: RoundRun,
  cfg: CouncilConfig,
  mode: CouncilMode,
  opening: CouncilState,
  market: MarketSource = liveMarket,
  requests: RequestSource = liveRequests,
): Promise<void> {
  let heardRequest: ActiveRequest | null = null;
  let settled = false;
  try {
    const startedAt = opening.lastRoundAt;
    const board = await market.board(opening);
    const { stats: listed, market1h } = board;
    if (listed.length === 0) throw new Error("No market data available");
    let before = opening.portfolio;

    // A funder's request, if one is waiting. A failure here must not cost the desk its session.
    const asked = await requests.take(run.id, before.cash, opening.assets, market1h).catch((e) => {
      console.error("[council] could not read the request queue:", e instanceof Error ? e.message : e);
      return null;
    });
    heardRequest = asked;
    const request = asked?.brief ?? null;
    let assets = opening.assets;
    if (board.assets) {
      // The desk remembers the tokens on its board: where they live on-chain, and the pools that price them.
      const onBoard = board.assets;
      assets = { ...assets, ...onBoard };
      await updateState((s) => ({ ...s, assets: { ...s.assets, ...onBoard }, board: Object.keys(onBoard) }));
    }
    if (asked && request) {
      assets = { ...assets, [request.asset.key]: { ...request.asset, quote: asked.quote, quotedAt: Date.now() } };
      const known = assets;
      await updateState((s) => ({ ...s, assets: { ...s.assets, [request.asset.key]: known[request.asset.key] } }));
    }

    // ETH and Stock Tokens are what the desk used to trade. It buys them now only when a funder asks for one.
    const old = (t: AssetKey) => isToken(t) || assets[t]?.kind === "stock";
    const sold: OwnTrade[] = [];
    if (board.assets && !opening.woundDown) {
      // Once, when the desk stopped trading them: what the agents had bought of them on their own is sold.
      // What a funder asked for stays, with the agent who is bound to it.
      for (const pos of before.positions.filter((p) => old(p.token) && listed.find((s) => s.token === p.token)?.session !== "closed")) {
        const price = await market.price(pos.token, assets).catch(() => null);
        if (!price) continue;
        for (const agent of AGENT_ORDER) {
          if (pos.stake[agent] < 0.01 || (pos.lockedUntil !== undefined && agent === pos.leader)) continue;
          const ts = Date.now();
          let made: Fill | null = null;
          const saved = await updateState((s) => {
            const done = sell(s.portfolio, { token: pos.token, price, fraction: 1, reason: "OWN", round: run.id, leader: agent, ts, id: `wind-${run.id}-${agent}-${pos.token}`, only: agent });
            if (!done) return s;
            made = { ...done.fill, note: `${nameOf(agent)} sold its ${pos.token} at ${px(price)}, as the desk no longer trades ${isToken(pos.token) && pos.token === "ETH" ? "ETH" : "Stock Tokens"}. Realized ${signed(done.fill.realized ?? 0, "")} USDG.` };
            return { ...s, portfolio: done.portfolio, fills: [...s.fills, made] };
          });
          const f = made as Fill | null;
          if (f) sold.push({ agent, fill: f, portfolio: saved.portfolio, note: f.note! });
          before = saved.portfolio;
        }
      }
      const lines = sold.map((t) => t.note);
      await updateState((s) => ({ ...s, woundDown: true, recent: [...s.recent, ...(lines.length ? [`Round ${run.id}: the desk stopped trading ETH and Stock Tokens, and sold what the agents had bought of them on their own.`] : [])] }));
    }

    // Requested tokens the desk already holds are on the board too, so the agents can judge and sell them.
    const heldAssets = before.positions.map((p) => p.token).filter((t) => assets[t] && t !== request?.asset.key && !listed.some((s) => s.token === t));
    const heldStats = await Promise.all(
      heldAssets.map(async (t) => {
        const quote = await assetQuote(assets[t]).catch(() => null);
        return quote ? assetStats(assets[t], quote, market1h).catch(() => null) : null;
      }),
    );
    // A board of Pons tokens: what an agent holds of other tokens is its to keep or sell, and does not count as its position.
    const pons = !!board.assets && Object.values(board.assets).length > 0 && Object.values(board.assets).every((a) => a.launchpad === "pons");
    const counts = (t: AssetKey) => !old(t) && (!pons || assets[t]?.launchpad === "pons");
    const stillHeld = (s: TokenStats) => !old(s.token) || !!positionOf(before, s.token);
    const stats = [...listed.filter((s) => s.token !== request?.asset.key && stillHeld(s)), ...heldStats.filter((s): s is TokenStats => !!s), ...(asked ? [asked.stats] : [])];
    // The agents buy what is on the board. Anything else they hold can only be sold.
    const onBoard = board.assets ? Object.keys(board.assets) : listed.map((s) => s.token).filter((t) => !(board.sellOnly ?? []).includes(t));
    const sellOnly = stats.map((s) => s.token).filter((t) => !onBoard.includes(t) && t !== request?.asset.key);
    const prices: Prices = Object.fromEntries(stats.map((s) => [s.token, s.price]));

    // A Stock Token can't be bought or sold while its market is closed. Nor, when the desk trades on the market, can a token its wallets can't swap.
    const closed = stats.filter((s) => s.session === "closed" || notTradable(assets[s.token]) !== null).map((s) => s.token);
    if (realTrading() && closed.length === stats.length) throw new Error("No token on the board can be traded on the market right now");
    // The desk called this session itself, to vote on selling a position that is up.
    const called = !request && opening.sellCall && positionOf(before, opening.sellCall.token) ? opening.sellCall : null;

    const lens: Record<AgentId, Skill> = perAgent((a) => pickLens(a, opening.lenses[a] ?? []));
    const effort: Record<AgentId, Effort> = perAgent((a) => fundingLevel(userFunding(before, a)).effort);
    const said = await recentLines().catch(() => perAgent<string[]>(() => []));
    /** Remembers a line so the same agent won't repeat it later in this round. */
    const floor: string[] = [];
    const heard = <T extends { agent: AgentId; say: string }>(line: T): T => {
      said[line.agent].push(line.say);
      if (!floor.includes(line.say)) floor.push(line.say);
      return line;
    };
    /** Brings back what each agent said when the desk last debated this token, so it is not said again. */
    const recall = async (token: AssetKey) => {
      const earlier = await linesAbout(token, run.id).catch(() => null);
      if (!earlier) return;
      for (const a of AGENT_ORDER) said[a].unshift(...earlier[a].filter((line) => !said[a].includes(line)));
    };
    if (request) await recall(request.asset.key);

    const ctx: RoundCtx = {
      round: run.id,
      stats,
      portfolio: before,
      prices,
      sellable: before.positions.filter((p) => canSell(before, p.token, run.id) && !closed.includes(p.token)).map((p) => p.token),
      closed,
      recent: called ? [...opening.recent, `The desk called this session: ${called.token} is up ${usd(called.pnl)} after what selling costs. The vote is on selling it now and taking that profit.`] : opening.recent,
      said,
      floor,
      lens,
      effort,
      request,
      // Every agent keeps a position open. One that holds nothing opens one this round, unless a funder's request has the floor.
      taken: [],
      // What it holds of the tokens the desk no longer trades does not count.
      mustTrade: perAgent((a) => !request && !invested(before, a, (pos) => counts(pos.token)) && Math.floor(before.cash[a] * OWN_BOOK_SHARE) >= SOLO_USD[0] && stats.some((s) => !closed.includes(s.token) && !sellOnly.includes(s.token))),
      sellOnly,
      pons,
      mine: perAgent((a) => before.positions.filter((p) => canSellOwn(before, p.token, a, run.id) && !closed.includes(p.token)).map((p) => p.token)),
    };
    // Some agents are given Jev's odds to weigh. Without them they decide on the figures alone.
    if (mode === "live" && cfg.withOdds.length) {
      const up1h = await oddsFromJev(cfg, ctx).catch((e) => (console.error("[council] Jev's odds could not be had:", e instanceof Error ? e.message.split("\n")[0] : e), null));
      if (up1h) ctx.odds = { for: cfg.withOdds, up1h };
    }
    await updateState((s) => ({ ...s, lenses: perAgent((a) => [...(s.lenses[a] ?? []), lens[a].id].slice(-LENS_MEMORY)) }));
    run.push({ stage: "open", round: run.id, mode, stats, portfolio: before, startedAt, request, sold: sold.length ? sold : undefined, fitted: true });

    const think = thinker(cfg, mode);
    const sellPct = { quant: 100, degen: 100, guardian: 100, oracle: 100 } as Record<AgentId, number>;

    // 1. Pitches
    const pitch = async (agent: AgentId): Promise<Pitch> => {
      const raw = await think(agent, (b) => b.pitch(agent, ctx));
      const p = enforcePitch(agent, ctx, raw);
      sellPct[agent] = p.sellPct;
      // The face follows the situation, not the feeling the model named.
      const held = positionOf(before, p.token);
      const losing = !!held && (prices[p.token] ?? held.entryPrice) < held.entryPrice;
      const emotion = moodFor({ kind: "pitch", action: p.action, conviction: p.conviction, losing });
      return heard({ agent, action: p.action, token: p.token, stakeUsd: p.stakeUsd, stopPct: p.stopPct, targetPct: p.targetPct, conviction: p.conviction, emotion, say: p.say, source: raw.source });
    };
    let pitches: Pitch[];
    if (AGENT_ORDER.some((a) => ctx.mustTrade[a])) {
      // Agents opening a first position choose one after another, each knowing what the others took,
      // so the desk's books are spread. Who chooses first moves round the desk.
      const order = AGENT_ORDER.map((_, i) => AGENT_ORDER[(i + run.id) % AGENT_ORDER.length]);
      const made: Pitch[] = [];
      for (const agent of order) {
        const p = await pitch(agent);
        made.push(p);
        if (ctx.mustTrade[agent] && p.action === "BUY" && !ctx.taken.includes(p.token)) ctx.taken.push(p.token);
      }
      pitches = AGENT_ORDER.map((a) => made.find((p) => p.agent === a)!);
    } else {
      pitches = await Promise.all(AGENT_ORDER.map(pitch));
    }
    // A funder's request takes the floor. Otherwise the strongest pitch does.
    const asking = request && pitches.find((p) => p.agent === request.agent && p.action === "BUY" && p.token === request.asset.key);
    if (asked && !asking) {
      await requests.finish(asked.id, "failed", `${nameOf(asked.brief.agent)} had too little cash free to present the request.`);
      settled = true;
    }
    let proposal: Proposal | null = asking
      ? { leader: asking.agent, action: "BUY", token: asking.token, stopPct: asking.stopPct, targetPct: asking.targetPct, sellPct: 100 }
      : chooseProposal(pitches, sellPct, ctx.sellable);
    const bound = !!asking && request?.mode === "commit";
    if (called) {
      // The sale is the proposal, whatever was pitched. The agent that answers for the position leads it.
      const pos = positionOf(before, called.token)!;
      const pct = (from: number, to: number) => Math.round(Math.abs(to / from - 1) * 1000) / 10;
      proposal = { leader: pos.leader, action: "SELL", token: called.token, stopPct: pct(pos.entryPrice, pos.stop), targetPct: pct(pos.entryPrice, pos.target), sellPct: 100 };
    }
    run.push({ stage: "pitches", pitches, proposal });

    /**
     * An agent's trade for its own book: an idea the council did not take up, traded by the
     * agent who had it, alone and with its own cash. A sale is of the agent's own tokens, and
     * leaves the other holders' where they are.
     */
    async function tradeOwn(p: Pitch, terms: { stopPct: number; targetPct: number }): Promise<OwnTrade | null> {
      const price = await market.price(p.token, assets).catch(() => prices[p.token]);
      if (!price) return null;
      const ts = Date.now();
      const id = `own-${run.id}-${p.agent}-${p.token}-${ts}`;
      const fitted = fitTerms(terms.stopPct, terms.targetPct, stats.find((s) => s.token === p.token)?.atrPct ?? 0);
      let made: Fill | null = null;
      let adding = false;
      const noted = (f: Fill, portfolio: Portfolio): OwnTrade => {
        const who = nameOf(p.agent);
        const note =
          f.side === "BUY"
            ? adding
              ? `${who} added ${usd(f.usd)} of ${f.token} at ${px(f.price)} for its own book.`
              : `${who} bought ${usd(f.usd)} of ${f.token} at ${px(f.price)} for its own book. Stop ${fitted.stopPct}% below, target ${fitted.targetPct}% above.`
            : `${who} sold its ${f.token} at ${px(f.price)}. Realized ${signed(f.realized ?? 0, "")} USDG.`;
        return { agent: p.agent, fill: f, portfolio, note };
      };

      if (realTrading()) {
        // On the market the agent's wallet makes the swap first, and the books then follow what it did.
        return inRealTurn(async () => {
          const book = (await readState()).portfolio;
          const held = positionOf(book, p.token);
          if (p.action === "BUY") {
            const wanted = zeroStakes();
            wanted[p.agent] = Math.min(p.stakeUsd, Math.floor(book.cash[p.agent] * OWN_BOOK_SHARE));
            if (wanted[p.agent] < SOLO_USD[0]) return null;
            const stakes = fitStakes(book, p.token, wanted, prices);
            if (stakes[p.agent] <= 0) return null;
            const bought = await buyTogether(assets[p.token], stakes);
            if (!(bought.units[p.agent] > 0)) return null;
            adding = !!held;
            const saved = await updateState((s) => {
              const done = buy(s.portfolio, { token: p.token, price: priceOf(bought.stakes, bought.units), stakes: bought.stakes, ...fitted, round: run.id, leader: p.agent, ts, id, reason: "OWN", keepTerms: true, real: { units: bought.units, txs: bought.txs } });
              made = done.fill;
              return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill] };
            });
            const f = made as Fill | null;
            return f ? noted(f, saved.portfolio) : null;
          }
          if (!held || !canSellOwn(book, p.token, p.agent, run.id)) return null;
          const fraction = sellPct[p.agent] / 100;
          const sale = await sellTogether(assets[p.token], [p.agent], fraction);
          if (!sale) return null;
          const saved = await updateState((s) => {
            const done = sell(s.portfolio, { token: p.token, price: priceOf(sale.usd, sale.units), fraction, reason: "OWN", round: run.id, leader: p.agent, ts, id, only: p.agent, real: sale });
            if (!done) return s;
            made = done.fill;
            return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill] };
          });
          const f = made as Fill | null;
          return f ? noted(f, saved.portfolio) : null;
        });
      }

      const saved = await updateState((s) => {
        made = null;
        const book = s.portfolio;
        const held = positionOf(book, p.token);
        if (p.action === "BUY") {
          const wanted = zeroStakes();
          wanted[p.agent] = Math.min(p.stakeUsd, Math.floor(book.cash[p.agent] * OWN_BOOK_SHARE));
          // A purchase of an agent's own has a least size. With less than that free, it makes none.
          if (wanted[p.agent] < SOLO_USD[0]) return s;
          const stakes = fitStakes(book, p.token, wanted, prices);
          if (stakes[p.agent] <= 0) return s;
          adding = !!held;
          const done = buy(book, { token: p.token, price, stakes, ...fitted, round: run.id, leader: p.agent, ts, id, reason: "OWN", keepTerms: true });
          made = done.fill;
          return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill], lastRiskCheck: s.portfolio.positions.length ? s.lastRiskCheck : ts };
        }
        if (!held || !canSellOwn(book, p.token, p.agent, run.id)) return s;
        const done = sell(book, { token: p.token, price, fraction: sellPct[p.agent] / 100, reason: "OWN", round: run.id, leader: p.agent, ts, id, only: p.agent });
        if (!done) return s;
        made = done.fill;
        return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill] };
      });
      const f = made as Fill | null;
      return f ? noted(f, saved.portfolio) : null;
    }

    /** Trades for their own books by every agent that pitched one and is not in `except`. */
    async function ownBooks(except: AgentId[], leaderTerms?: { agent: AgentId; stopPct: number; targetPct: number }): Promise<OwnTrade[]> {
      const made: OwnTrade[] = [];
      if (request) return made;
      for (const p of pitches) {
        if (p.action === "HOLD" || except.includes(p.agent)) continue;
        const terms = leaderTerms?.agent === p.agent ? leaderTerms : p;
        const trade = await tradeOwn(p, terms).catch((e) => (console.error(`[council] ${p.agent}'s own trade failed:`, e instanceof Error ? e.message : e), null));
        if (trade) made.push(trade);
      }
      if (made.length) {
        const line = `Round ${run.id}, own books: ${made.map((t) => `${nameOf(t.agent)} ${t.fill.side === "BUY" ? "bought" : "sold"} ${t.fill.token} (${usd(t.fill.usd)})`).join("; ")}.`;
        await updateState((s) => ({ ...s, recent: [...s.recent, line] }));
      }
      return made;
    }

    if (!proposal) {
      // Nothing was put to the council. An agent may still have decided to sell what is its own.
      const own = await ownBooks([]);
      const note = own.length ? "No trade was put to the council this round. The agents trade their own books." : "The council holds. No agent proposed a trade this round.";
      if (!own.length) await updateState((s) => ({ ...s, recent: [...s.recent, `Round ${run.id}: every agent chose to hold. No trade.`] }));
      run.push({ stage: "outcome", fill: null, portfolio: before, note, own });
      return;
    }
    const leader = proposal.leader;
    // Whatever the agents ask for, a purchase gets a stop that the token's ordinary movement can't set off.
    const noise = stats.find((s) => s.token === proposal!.token)?.atrPct ?? 0;
    const fitted = (p: Proposal, stopPct: number, targetPct: number): Proposal => (p.action === "BUY" ? { ...p, ...fitTerms(stopPct, targetPct, noise) } : p);
    const first = fitted(proposal, proposal.stopPct, proposal.targetPct);
    if (!asking) await recall(first.token);
    // Adding to a token the desk debated when it bought it: no second debate, only who joins.
    const addOn = !!asking && !!positionOf(before, first.token);

    // 2. Debate at the leader's desk. One challenger at a time, so the leader's answers build on each other.
    const exchanges: Exchange[] = [];
    let terms = first;
    for (const agent of addOn ? [] : chooseChallengers(pitches, first)) {
      const current = terms;
      const soFar = [...exchanges];
      const c = await think(agent, (b) => b.challenge(agent, ctx, current, pitches, soFar));
      const own = pitches.find((p) => p.agent === agent);
      const agrees = !!own && own.action === current.action && own.token === current.token;
      // Strongly against: it would do the opposite with this token, or is sure of a trade of its own.
      const against = !!own && !agrees && ((own.token === current.token && own.action !== "HOLD") || (own.action !== "HOLD" && own.conviction >= 4));
      const challenge: Line = heard({ agent, to: leader, emotion: moodFor({ kind: "challenge", agrees, against }), say: c.say, source: c.source });
      const r = await think(leader, (b) => b.reply(leader, ctx, current, challenge, soFar));
      terms = fitted(current, r.stopPct, r.targetPct);
      exchanges.push({ challenge, reply: heard({ agent: leader, to: agent, emotion: moodFor({ kind: "reply" }), say: r.say, source: r.source }) });
    }
    proposal = terms;
    const final = proposal;
    run.push({ stage: "debate", exchanges });

    // 3. Pledges. A vote is whatever the agent did with its money, so the two can't disagree.
    const buying = final.action === "BUY";
    /**
     * What a backer puts into a purchase the agents make together: as much as it puts into one
     * of its own, no less and no more, if it has that much. With less, it puts in nothing.
     * A funder's request is joined with whatever the agent names.
     */
    const backing = (agent: AgentId, named: number) => {
      const cash = Math.floor(before.cash[agent]);
      if (asking) return Math.floor(clamp(named, 0, cash));
      const stake = Math.min(Math.floor(clamp(named, ...SOLO_USD)), cash);
      return stake >= SOLO_USD[0] ? stake : 0;
    };
    const renamed = (text: string, named: number, got: number) => (Math.floor(named) === got ? text : cleanSay(text.replace(new RegExp(`\\$${Math.floor(named)}(?!\\d|\\.\\d)`, "g"), () => `$${got}`)));
    const pledges: Pledge[] = await Promise.all(
      AGENT_ORDER.filter((a) => a !== leader).map(async (agent) => {
        // An agent that pitched the same trade has already decided. It joins with what it named.
        const mine = pitches.find((x) => x.agent === agent)!;
        if (!asking && mine.action === final.action && mine.token === final.token) {
          const stake = buying ? backing(agent, mine.stakeUsd) : 0;
          const say = buying
            ? pick([`My pick too. In for $${stake}.`, `Same trade I pitched. $${stake} from me.`, `I had ${final.token} as well. Joining with $${stake}.`], ctx, agent)
            : pick([`I pitched the same sale. Agreed.`, `My call too. Sell ${final.token}.`], ctx, agent);
          said[agent].push(say);
          return { agent, to: leader, emotion: moodFor({ kind: "pledge", support: true }), say, source: mine.source, support: !buying || stake >= 1, stakeUsd: stake, reason: "pitched the same trade" };
        }
        const p = await think(agent, (b) => b.pledge(agent, ctx, final, pitches, exchanges));
        const stakeUsd = p.support && buying ? backing(agent, p.stakeUsd) : 0;
        const support = p.support && (!buying || stakeUsd >= 1);
        // An agent that backs the trade but has too little cash free for its part stays out, and says so.
        const short = p.support && buying && !support;
        const say = short ? pick([`I back it, but I have no ${usd(SOLO_USD[0])} free. Out.`, `Good trade. My cash is at work, so I can't join.`, `I would join. Too little free for my part.`], ctx, agent) : renamed(p.say, p.stakeUsd, stakeUsd);
        return heard({ agent, to: leader, emotion: moodFor({ kind: "pledge", support }), say, source: p.source, support, stakeUsd: support ? stakeUsd : 0, reason: short ? "too little cash free" : p.reason || (support ? "backs the trade" : "does not back the trade") });
      }),
    );

    const offers = zeroStakes();
    offers[leader] = pitches.find((p) => p.agent === leader)?.stakeUsd ?? 0;
    for (const p of pledges) offers[p.agent] = p.stakeUsd;
    // A purchase the agents make together has a size of its own, which its backers share out. A funder's request is bought as it was asked for.
    const wanted = buying && !asking ? shareOut(offers, COUNCIL_MAX_USD, leader) : offers;
    for (const p of pledges) {
      if (p.stakeUsd === wanted[p.agent]) continue;
      // What the agent says names the share it gets.
      p.say = cleanSay(p.say.replace(new RegExp(`\\$${Math.floor(p.stakeUsd)}(?!\\d|\\.\\d)`, "g"), () => `$${wanted[p.agent]}`));
      p.stakeUsd = wanted[p.agent];
    }
    const stakes = buying ? fitStakes(before, final.token, wanted, prices) : zeroStakes();
    const totalUsd = AGENT_ORDER.reduce((t, a) => t + stakes[a], 0);

    const yes = 1 + pledges.filter((p) => p.support).length;
    const tooSmall = buying && totalUsd === 0;
    const passed = yes >= VOTES_TO_PASS;
    // A committed leader's trade is not put to a vote. The others only choose whether to join with their own cash.
    const approved = (passed || bound) && !tooSmall;
    const joined = backers(pledges, nameOf);

    const votes: Vote[] = AGENT_ORDER.map((agent) => {
      if (agent === leader) return { agent, approve: true, reason: bound ? "committed to its funder" : "leads the proposal" };
      const p = pledges.find((x) => x.agent === agent)!;
      return { agent, approve: p.support, reason: p.reason };
    });

    // Without the council's backing the leader still trades its idea, alone: a purchase with its own cash, a sale of its own tokens.
    const ownUsd = buying ? Math.min(pitches.find((p) => p.agent === leader)?.stakeUsd ?? 0, Math.floor(before.cash[leader] * OWN_BOOK_SHARE)) : 0;
    const alone = !approved && !asking && (buying ? ownUsd >= SOLO_USD[0] : canSellOwn(before, final.token, leader, run.id));
    const c = await think(leader, (b) => b.closing(leader, ctx, final, { pledges, approved, yes, totalUsd: alone ? ownUsd : totalUsd, committed: bound, alone }));
    const sure = pitches.find((p) => p.agent === leader)?.conviction ?? 0;
    const closing: Line = { agent: leader, emotion: moodFor({ kind: "closing", approved, alone, conviction: sure, yes }), say: c.say, source: c.source };
    run.push({ stage: "decision", pledges, closing, votes, approved, committed: bound });

    // 4. Order
    let fill: Fill | null = null;
    let after: Portfolio = before;
    let note: string;

    if (!approved) {
      note = tooSmall && (passed || bound) ? "The order was under the desk's minimum size after limits. No trade." : `Proposal rejected ${yes} to ${4 - yes}. No trade this round.`;
    } else {
      const ts = Date.now();
      const id = `r${run.id}-${final.token}-${ts}`;
      let price = prices[final.token]!;
      /** Why no order was placed, when the market or the desk's own limits refused it. */
      let refused: string | null = null;
      if (realTrading()) {
        // On the market each backer's wallet makes its own swap, and the books then follow what the swaps did.
        await inRealTurn(async () => {
          if (buying) {
            const bought = await buyTogether(assets[final.token], stakes);
            if (!AGENT_ORDER.some((a) => bought.units[a] > 0)) {
              refused = bought.why ?? "No swap went through";
              return;
            }
            price = priceOf(bought.stakes, bought.units);
            const saved = await updateState((s) => {
              const done = buy(s.portfolio, { token: final.token, price, stakes: bought.stakes, stopPct: final.stopPct, targetPct: final.targetPct, round: run.id, leader, ts, id, committed: bound, real: { units: bought.units, txs: bought.txs } });
              fill = done.fill;
              return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill], lastRiskCheck: ts };
            });
            after = saved.portfolio;
            return;
          }
          const held = positionOf((await readState()).portfolio, final.token);
          const sale = held ? await sellTogether(assets[final.token], AGENT_ORDER.filter((a) => held.stake[a] > 0.005), final.sellPct / 100) : null;
          if (!sale) {
            refused = "No swap went through";
            return;
          }
          price = priceOf(sale.usd, sale.units);
          const saved = await updateState((s) => {
            const done = sell(s.portfolio, { token: final.token, price, fraction: final.sellPct / 100, reason: "COUNCIL", round: run.id, leader, ts, id, real: sale });
            if (!done) return s;
            fill = done.fill;
            return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill], lastRiskCheck: ts };
          });
          after = saved.portfolio;
        });
      } else {
        price = await market.price(final.token, assets).catch(() => prices[final.token]!);
        const saved = await updateState((s) => {
          const done = buying
            ? buy(s.portfolio, { token: final.token, price, stakes, stopPct: final.stopPct, targetPct: final.targetPct, round: run.id, leader, ts, id, committed: bound })
            : sell(s.portfolio, { token: final.token, price, fraction: final.sellPct / 100, reason: "COUNCIL", round: run.id, leader, ts, id });
          if (!done) return s;
          fill = done.fill;
          return { ...s, portfolio: done.portfolio, fills: [...s.fills, done.fill], lastRiskCheck: ts };
        });
        after = saved.portfolio;
      }
      const f = fill as Fill | null;
      note = !f
        ? `${refused ?? "The order could not be placed"}. No trade.`
        : buying
          ? bound
            ? `${nameOf(leader)} bought ${usd(f.usd)} of ${f.token} at ${px(price)} for its funder, joined by ${joined}. Stop ${final.stopPct}% below, target ${final.targetPct}% above. Held for at least ${COMMITTED_HOLD_ROUNDS} sessions unless one of them is hit.`
            : `Bought ${usd(f.usd)} of ${f.token} at ${px(price)}. Stop ${final.stopPct}% below, target ${final.targetPct}% above.`
          : `Sold ${final.sellPct}% of ${f.token} at ${px(price)}. Realized ${signed(f.realized ?? 0, "")} USDG.`;
    }

    const origin = asking ? " at a funder's request" : "";
    const summary = approved && fill
      ? bound
        ? `Round ${run.id}: ${nameOf(leader)} bought ${final.token}${origin}, as committed; joined by ${joined}.`
        : `Round ${run.id}: council ${buying ? "bought" : "sold"} ${final.token}${origin}, led by ${nameOf(leader)} (passed ${yes} to ${4 - yes}).`
      : `Round ${run.id}: ${nameOf(leader)} proposed to ${final.action} ${final.token}${origin}; ${passed || bound ? "no order was placed" : `rejected ${yes} to ${4 - yes}`}.`;
    await updateState((s) => ({ ...s, recent: [...s.recent, summary] }));
    if (asked && asking) {
      await requests.finish(asked.id, fill ? "executed" : passed || bound ? "failed" : "rejected", note);
      settled = true;
    }
    // Whoever took part in the council's trade has traded. Everyone else trades the idea it pitched.
    const traded = fill as Fill | null;
    const inCouncilTrade = traded ? AGENT_ORDER.filter((a) => a === leader || (buying && traded.stake[a] > 0)) : [];
    const own = await ownBooks(inCouncilTrade, { agent: leader, stopPct: final.stopPct, targetPct: final.targetPct });
    if (!approved && own.length) note = `The council did not back ${nameOf(leader)}'s proposal, ${yes} to ${4 - yes}, so there is no desk trade. The agents trade their own books.`;
    run.push({ stage: "outcome", fill, portfolio: after, note, own });
  } catch (e) {
    console.error("[council] round failed:", e);
    run.failed = true;
    if (heardRequest && !settled) await requests.release(heardRequest.id).catch(() => {});
    run.push({ stage: "error", message: "The council could not complete this round. It will try again at the next session." });
  } finally {
    run.finish();
    // A vote the desk called before this session began has now been held, whatever came of it.
    await updateState((s) => (s.sellCall && s.sellCall.at <= opening.lastRoundAt ? { ...s, sellCall: undefined } : s)).catch(() => {});
    void settleOnChain(true);
    await saveRound(run.id, run.stages, run.failed).catch((e) => console.error("[council] could not save the round:", e));
  }
}
