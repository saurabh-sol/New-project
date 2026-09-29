/**
 * Plays council sessions in the browser. The server decides what the agents say and
 * do; this file decides how it is staged: who walks where, and how long each line is held.
 */
import { AGENT_ORDER, AGENTS } from "./agents";
import type { DeskAsset, RequestBrief } from "./assets";
import { agentPnl, type Emotion, type Fill } from "./council";
import type { CouncilSnapshot, Line, OwnTrade, Proposal, RoundResponse, Stage } from "./council-types";
import { walkSeconds } from "./layout";
import type { AgentId, AgentState, ArenaEvent, ChatMessage, MessageKind, Spot } from "./types";
import { fmtPrice, fmtSigned } from "./utils";
import { useArena } from "@/store/arena";
import { livePrices, useMarket } from "@/store/market";

const HOME: Spot = { kind: "home" };
const TABLE: Spot = { kind: "table" };
const SETTLE_MS = 250;
const POLL_MS = 15_000;

class Stopped extends Error {}

const uid = () => Math.random().toString(36).slice(2, 10);

/**
 * Passes on the prices the server last saw, for tokens the page has no price for yet.
 * A price from the live feed is newer, and is left alone.
 */
function learn(assets: Record<string, DeskAsset>) {
  const known = useMarket.getState().quotes;
  const quotes = Object.fromEntries(
    Object.values(assets)
      .filter((a) => !known[a.key])
      .map((a) => [a.key, { price: a.quote.price, change24h: a.quote.change24h }]),
  );
  if (Object.keys(quotes).length) useMarket.getState().setAssetQuotes(quotes);
}
/** Time a speech bubble needs to type out, plus a beat to read it. */
const readTime = (text: string) => Math.min(text.length * 26 + 1400, 5000);

// The last session this browser watched to the end. A session is played once, not on every visit.
const WATCHED = "council:watched";
function lastWatched(): number {
  try {
    return Number(localStorage.getItem(WATCHED)) || 0;
  } catch {
    return 0;
  }
}
function markWatched(round: number) {
  try {
    if (round > lastWatched()) localStorage.setItem(WATCHED, String(round));
  } catch {}
}

// How far into the session on stage this browser has watched, counted in lines.
// After a refresh the session picks up from there instead of starting over.
const PROGRESS = "council:progress";
function savedProgress(round: number): number {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS) ?? "null") as { round?: number; lines?: number } | null;
    return p?.round === round && typeof p.lines === "number" ? p.lines : 0;
  } catch {
    return 0;
  }
}
function saveProgress(round: number, lines: number) {
  try {
    localStorage.setItem(PROGRESS, JSON.stringify({ round, lines }));
  } catch {}
}

/** The time of day, with the date as well when it was not today. */
function clock(ms: number): string {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `${time} on ${at.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

// What the desk's notes say. Shared by a session as it plays and by the record of one that is over.
const openingNote = (round: number, replayOf: number | null) =>
  replayOf === null ? `Session ${round} opens. The desk is reading the market.` : `Session ${round}, held at ${clock(replayOf)}. This is a replay.`;

function requestNote(r: RequestBrief): string {
  const who = AGENTS[r.agent].name;
  return r.mode === "commit"
    ? `A funder put $${r.usd.toFixed(0)} behind ${who} and asked for ${r.asset.key}. ${who} is committed to the trade. The others decide whether to join.`
    : `A funder put $${r.usd.toFixed(0)} behind ${who} and asked for ${r.asset.key}. The whole desk weighs it, then votes.`;
}

function proposalNote(p: Proposal, request: RequestBrief | null): string {
  const who = AGENTS[p.leader].name;
  if (request && p.token === request.asset.key) return `${who} puts the funder's request to the desk: buy ${p.token}.`;
  return p.action === "BUY" ? `${who} leads with a proposal to buy ${p.token}.` : `${who} leads with a proposal to sell ${p.sellPct}% of the desk's ${p.token}.`;
}

/** A committed trade is not voted on, so the others answer IN or OUT instead of YES or NO. */
const voteWord = (approve: boolean, committed: boolean) => (committed ? (approve ? "IN" : "OUT") : approve ? "YES" : "NO");

/** The conversation of a finished session, as it would stand in the transcript once played. */
function transcriptOf(stages: Stage[]): { round: number; messages: ChatMessage[] } | null {
  const open = stages.find((s) => s.stage === "open");
  if (!open || open.stage !== "open") return null;
  const round = open.round;
  const request = open.request ?? null;
  const messages: ChatMessage[] = [];
  let ts = open.startedAt;
  const add = (agent: AgentId, kind: MessageKind, text: string, line?: Line) =>
    messages.push({ id: `r${round}-${messages.length}`, agent, kind, text, ts: (ts += 4000), round, to: line?.to, emotion: line?.emotion, source: line?.source });
  const spoken = (line: Line, kind: MessageKind) => add(line.agent, kind, line.say, line);

  add("guardian", "system", `Session ${round}, held at ${clock(open.startedAt)}.`);
  for (const t of open.sold ?? []) add(t.agent, "system", t.note);
  if (request) add(request.agent, "system", requestNote(request));
  let leader: AgentId = "guardian";
  for (const s of stages) {
    if (s.stage === "pitches") {
      s.pitches.forEach((p) => spoken(p, "pitch"));
      if (s.proposal) add((leader = s.proposal.leader), "system", proposalNote(s.proposal, request));
    }
    if (s.stage === "debate") s.exchanges.forEach((e) => (spoken(e.challenge, "debate"), spoken(e.reply, "debate")));
    if (s.stage === "decision") {
      s.pledges.forEach((p) => spoken(p, "negotiate"));
      s.votes.forEach((v) => add(v.agent, "vote", `${voteWord(v.approve, !!s.committed)}: ${v.reason}`));
      spoken(s.closing, "closing");
    }
    if (s.stage === "outcome") {
      add(leader, "system", s.note);
      for (const t of s.own ?? []) add(t.agent, "system", t.note);
    }
  }
  return { round, messages };
}

/** How many past sessions are read from the desk's record at a time. */
const HISTORY_PAGE = 6;

/**
 * Puts past sessions' conversation on the page, read from the desk's record on the server.
 * The record is the same for everyone, so a new visitor on a new device sees all of it.
 * `before` is the first session NOT wanted: sessions earlier than it are loaded.
 */
export async function loadHistory(apply: (e: ArenaEvent) => void, before: number, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`/api/council/history?before=${before}&limit=${HISTORY_PAGE}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error("The desk's history can't be reached right now.");
  const { sessions, more } = (await res.json()) as { sessions: Array<{ round: number; stages: Stage[] }>; more: boolean };
  for (const session of [...sessions].reverse()) {
    const record = transcriptOf(session.stages);
    if (record) apply({ type: "recap", ...record });
  }
  if (sessions.length) apply({ type: "history", oldest: sessions[sessions.length - 1].round, more });
}

/** Reads a newline-delimited JSON response one stage at a time. */
async function* readStages(res: Response): AsyncGenerator<Stage> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line) yield JSON.parse(line) as Stage;
    }
  }
}

export function startShow(apply: (e: ArenaEvent) => void): () => void {
  const ctrl = new AbortController();
  const { signal } = ctrl;
  const at = Object.fromEntries(AGENT_ORDER.map((a) => [a, HOME])) as Record<AgentId, Spot>;
  const knownFills = new Set<string>();
  /** The session on stage, or 0 between sessions. Every line is filed under it. */
  let playing = 0;
  /** Lines of the session on stage shown so far, and how many of them this browser had already watched. */
  let shown = 0;
  let watchedLines = 0;
  /** True while the show runs through what was watched before. Nothing is waited for, so it takes a moment. */
  const catchingUp = () => shown < watchedLines;
  /** Counts a line as shown. */
  const line = () => {
    shown++;
    if (playing && shown > watchedLines) saveProgress(playing, shown);
  };

  // --- staging primitives ---

  /** Waits, holding the show while the tab is hidden (browsers freeze animations there). */
  async function sleep(ms: number) {
    if (catchingUp()) {
      if (signal.aborted) throw new Stopped();
      return;
    }
    let left = ms;
    while (left > 0 || document.hidden) {
      if (signal.aborted) throw new Stopped();
      if (document.hidden) {
        await new Promise<void>((r) => {
          const done = () => (document.removeEventListener("visibilitychange", done), signal.removeEventListener("abort", done), r());
          document.addEventListener("visibilitychange", done);
          signal.addEventListener("abort", done);
        });
        continue;
      }
      const step = Math.min(left, 250);
      await new Promise((r) => setTimeout(r, step));
      left -= step;
    }
    if (signal.aborted) throw new Stopped();
  }

  const emit = (e: ArenaEvent) => {
    if (signal.aborted) throw new Stopped();
    apply(e);
  };
  const setState = (agent: AgentId, state: AgentState) => emit({ type: "agent_state", agent, state });
  const setAll = (state: AgentState) => AGENT_ORDER.forEach((a) => setState(a, state));
  const feel = (agent: AgentId, emotion: Emotion) => emit({ type: "emotion", agent, emotion });
  const system = (text: string, agent: AgentId = "guardian") => {
    emit({ type: "message", message: { id: uid(), agent, kind: "system", text, ts: Date.now(), round: playing || undefined } });
    if (playing) line();
  };

  /** Starts a walk and returns how long it takes, in ms. */
  function walk(agent: AgentId, to: Spot): number {
    const ms = walkSeconds(agent, at[agent], to) * 1000;
    emit({ type: "move", agent, to });
    at[agent] = to;
    return ms;
  }
  const walkAndWait = async (agent: AgentId, to: Spot) => sleep(walk(agent, to) + SETTLE_MS);
  const walkAll = async (agents: AgentId[], to: Spot) => sleep(Math.max(0, ...agents.map((a) => walk(a, to))) + SETTLE_MS);

  const count = line;
  async function say(line: Line, kind: MessageKind) {
    feel(line.agent, line.emotion);
    setState(line.agent, "speaking");
    emit({
      type: "message",
      message: { id: uid(), agent: line.agent, to: line.to, kind, text: line.say, ts: Date.now(), emotion: line.emotion, source: line.source, round: playing || undefined },
    });
    const quick = catchingUp();
    count();
    if (!quick) await sleep(readTime(line.say));
    setState(line.agent, "idle");
  }

  // --- talking to the server ---

  async function sync(): Promise<CouncilSnapshot | null> {
    try {
      const res = await fetch("/api/council/state", { signal, cache: "no-store" });
      if (!res.ok) return null;
      const snapshot = (await res.json()) as CouncilSnapshot;
      emit({ type: "sync", snapshot });
      learn(snapshot.assets ?? {});
      return snapshot;
    } catch (e) {
      if (e instanceof Stopped || signal.aborted) throw new Stopped();
      return null;
    }
  }

  // --- scenes ---

  /** Each agent's mood follows how its own money is doing. */
  function moodFromPnl(snapshot: CouncilSnapshot) {
    const prices = livePrices();
    for (const a of AGENT_ORDER) {
      const invested = snapshot.portfolio.positions.reduce((t, p) => t + p.stake[a], 0);
      if (invested === 0) {
        feel(a, "neutral");
        continue;
      }
      const pct = (agentPnl(snapshot.portfolio, a, prices) / invested) * 100;
      feel(a, pct > 0.4 ? "happy" : pct < -0.4 ? "worried" : "neutral");
    }
  }

  /** A stop-loss or profit target closed a position while the council was away. */
  async function riskExit(fill: Fill, snapshot: CouncilSnapshot) {
    const won = (fill.realized ?? 0) >= 0;
    const holders = AGENT_ORDER.filter((a) => fill.stake[a] > 0);
    emit({ type: "focus", token: fill.token });
    emit({ type: "fill", fill, portfolio: snapshot.portfolio });
    system(
      `${fill.reason === "STOP" ? "Stop-loss" : "Profit target"} hit: sold ${fill.token} at $${fmtPrice(fill.price)}. Realized ${fmtSigned(fill.realized ?? 0)}.`,
      fill.leader,
    );
    for (const a of holders) {
      feel(a, won ? "happy" : "sad");
      setState(a, won ? "win" : "loss");
    }
    await sleep(3200);
    for (const a of holders) setState(a, "idle");
  }

  /** An agent sold its tokens between sessions, because their price was falling fast. */
  async function soldIntoFall(fill: Fill, snapshot: CouncilSnapshot) {
    const won = (fill.realized ?? 0) >= 0;
    emit({ type: "focus", token: fill.token });
    emit({ type: "fill", fill, portfolio: snapshot.portfolio });
    system(fill.note ?? `${AGENTS[fill.leader].name} sold its ${fill.token} at $${fmtPrice(fill.price)} as the price fell. Realized ${fmtSigned(fill.realized ?? 0)}.`, fill.leader);
    feel(fill.leader, won ? "confident" : "worried");
    setState(fill.leader, "executing");
    await sleep(2600);
    setState(fill.leader, "idle");
  }

  /** The stretch between sessions: agents at their desks, watching their positions. */
  async function monitor(until: number, skew: number) {
    emit({ type: "phase", phase: "monitor" });
    emit({ type: "schedule", nextRoundAt: until });
    const away = AGENT_ORDER.filter((a) => at[a].kind !== "home");
    if (away.length) await walkAll(away, HOME);
    setAll("idle");

    while (Date.now() + skew < until) {
      const snapshot = await sync();
      if (snapshot) {
        for (const fill of snapshot.fills) {
          if (knownFills.has(fill.id)) continue;
          knownFills.add(fill.id);
          if (fill.reason === "STOP" || fill.reason === "TARGET") await riskExit(fill, snapshot);
          else if (fill.reason === "FALLING") await soldIntoFall(fill, snapshot);
        }
        moodFromPnl(snapshot);
      }
      // Someone checks their screen now and then.
      const busy = AGENT_ORDER[Math.floor(Math.random() * AGENT_ORDER.length)];
      setState(busy, "thinking");
      await sleep(2600);
      setState(busy, "idle");
      await sleep(Math.max(0, Math.min(POLL_MS, until - (Date.now() + skew))));
    }
  }

  /** Returns the session's number once it has been played to the end, or 0 if it broke off. */
  async function playRound(res: Response): Promise<number> {
    const replay = res.headers.get("x-council-replay") === "1";
    const stages = readStages(res);
    /** Waits for the server's next stage. Agents visibly think while the models are working. */
    async function next<K extends Stage["stage"]>(...kinds: K[]): Promise<Extract<Stage, { stage: K }> | null> {
      const thinking = setTimeout(() => !signal.aborted && AGENT_ORDER.forEach((a) => at[a].kind === "home" && apply({ type: "agent_state", agent: a, state: "thinking" })), 500);
      try {
        const { value, done } = await stages.next();
        if (done || !value) return null;
        if (value.stage === "error") {
          system(value.message);
          return null;
        }
        return (kinds as string[]).includes(value.stage) ? (value as Extract<Stage, { stage: K }>) : null;
      } finally {
        clearTimeout(thinking);
      }
    }

    const open = await next("open");
    if (!open) return 0;
    playing = open.round;
    shown = 0;
    watchedLines = savedProgress(open.round);
    emit({ type: "round_start", round: open.round, mode: open.mode, portfolio: open.portfolio, committed: open.request?.mode === "commit" });
    emit({ type: "phase", phase: "scan" });
    const away = AGENT_ORDER.filter((a) => at[a].kind !== "home");
    if (away.length) await walkAll(away, HOME);
    AGENT_ORDER.forEach((a) => feel(a, "neutral"));
    setAll("thinking");
    system(openingNote(open.round, replay ? open.startedAt : null));
    const scanStarted = Date.now();

    const request = open.request ?? null;
    if (request) {
      const seen = open.stats.find((s) => s.token === request.asset.key);
      const quote = { price: seen?.price ?? 0, change24h: seen?.change24h ?? 0, liquidityUsd: request.liquidityUsd, volume24hUsd: request.volume24hUsd };
      const asset: DeskAsset = { ...request.asset, quote, quotedAt: Date.now() };
      emit({ type: "assets", assets: { [asset.key]: asset } });
      if (seen) learn({ [asset.key]: asset });
      system(requestNote(request), request.agent);
    }

    /** Each agent that traded for its own book places its order from its own desk. */
    async function ownBooks(trades: OwnTrade[]) {
      for (const t of trades) {
        knownFills.add(t.fill.id);
        if (at[t.agent].kind !== "home") await walkAndWait(t.agent, HOME);
        emit({ type: "focus", token: t.fill.token });
        setState(t.agent, "executing");
        await sleep(1400);
        emit({ type: "fill", fill: t.fill, portfolio: t.portfolio });
        system(t.note, t.agent);
        feel(t.agent, t.fill.side === "BUY" ? "confident" : (t.fill.realized ?? 0) >= 0 ? "happy" : "sad");
        await sleep(1800);
        setState(t.agent, "idle");
      }
    }

    // What the desk sold before the session, because it no longer trades it.
    if (open.sold?.length) {
      setAll("idle");
      await ownBooks(open.sold);
      setAll("thinking");
    }

    // 1. Pitches
    const pitched = await next("pitches");
    if (!pitched) return open.round;
    await sleep(Math.max(0, 2500 - (Date.now() - scanStarted)));
    setAll("idle");
    emit({ type: "phase", phase: "pitch" });
    for (const p of pitched.pitches) {
      setState(p.agent, "thinking");
      await sleep(600);
      await say(p, "pitch");
    }

    const proposal = pitched.proposal;
    if (!proposal) {
      const outcome = await next("outcome");
      emit({ type: "phase", phase: "settle" });
      system(outcome?.note ?? "The council holds. No trade this round.");
      await sleep(2500);
      if (outcome?.own?.length) {
        emit({ type: "phase", phase: "execute" });
        await ownBooks(outcome.own);
        emit({ type: "phase", phase: "settle" });
      }
      return open.round;
    }
    const leader = proposal.leader;
    const buying = proposal.action === "BUY";
    emit({ type: "focus", token: proposal.token });
    system(proposalNote(proposal, request), leader);

    // 2. Debate at the leader's desk
    emit({ type: "phase", phase: "debate" });
    const debate = await next("debate");
    if (!debate) return open.round;
    setAll("idle");
    let visitor: AgentId | null = null;
    for (const { challenge, reply } of debate.exchanges) {
      const back = visitor && visitor !== challenge.agent ? walk(visitor, HOME) : 0;
      const there = walk(challenge.agent, { kind: "desk", of: leader });
      await sleep(Math.max(back, there) + SETTLE_MS);
      visitor = challenge.agent;
      await say(challenge, "debate");
      await say(reply, "debate");
    }
    if (visitor) await walkAndWait(visitor, HOME);

    // 3. Pledges: backers carry their cash over, the rest refuse from their own desks
    emit({ type: "phase", phase: "negotiate" });
    const decision = await next("decision");
    if (!decision) return open.round;
    setAll("idle");
    setState(leader, "negotiating");
    let leaving = 0;
    for (const pledge of decision.pledges) {
      if (pledge.support && buying && pledge.stakeUsd > 0) {
        setState(pledge.agent, "negotiating");
        await sleep(Math.max(walk(pledge.agent, { kind: "desk", of: leader }), leaving * 0.5) + SETTLE_MS);
        feel(pledge.agent, pledge.emotion);
        setState(pledge.agent, "speaking");
        emit({
          type: "message",
          message: { id: uid(), agent: pledge.agent, to: leader, kind: "negotiate", text: pledge.say, ts: Date.now(), emotion: pledge.emotion, source: pledge.source, round: playing },
        });
        const quick = catchingUp();
        line();
        if (!quick) await sleep(1400);
        // Coins that flew before the refresh don't fly again.
        if (!quick) emit({ type: "offer", id: uid(), from: pledge.agent, to: leader, amount: pledge.stakeUsd });
        await sleep(Math.max(1600, readTime(pledge.say) - 1400));
        setState(pledge.agent, "idle");
        leaving = walk(pledge.agent, HOME);
      } else {
        await sleep(leaving * 0.5);
        leaving = 0;
        await say(pledge, "negotiate");
      }
    }
    await sleep(leaving + SETTLE_MS);
    setState(leader, "idle");

    // 4. Vote at the table. Each vote is what that agent just did with its money.
    emit({ type: "phase", phase: "vote" });
    await walkAll(AGENT_ORDER, TABLE);
    const committed = !!decision.committed;
    let yes = 0;
    for (const v of decision.votes) {
      if (v.approve) yes++;
      setState(v.agent, "voting");
      await sleep(500);
      emit({ type: "vote", agent: v.agent, approve: v.approve, reason: v.reason, joining: committed });
      emit({
        type: "message",
        message: { id: uid(), agent: v.agent, kind: "vote", text: `${voteWord(v.approve, committed)}: ${v.reason}`, ts: Date.now(), round: playing },
      });
      line();
      emit({ type: "consensus", value: yes / decision.votes.length });
      await sleep(1500);
    }
    await sleep(800);
    setAll("idle");
    await say(decision.closing, "closing");

    // 5. Order
    const outcome = await next("outcome");
    if (!outcome) return open.round;
    if (outcome.fill) {
      knownFills.add(outcome.fill.id);
      emit({ type: "phase", phase: "execute" });
      await walkAndWait(leader, HOME);
      setState(leader, "executing");
      await sleep(2200);
      emit({ type: "fill", fill: outcome.fill, portfolio: outcome.portfolio });
      await sleep(900);
      setState(leader, "idle");
    }
    emit({ type: "phase", phase: "settle" });
    system(outcome.note, leader);

    const realized = outcome.fill?.realized;
    if (typeof realized === "number") {
      // A sale books a result, so the desk reacts to it.
      for (const a of AGENT_ORDER) {
        if (outcome.fill!.stake[a] <= 0) continue;
        feel(a, realized >= 0 ? "happy" : "sad");
        setState(a, realized >= 0 ? "win" : "loss");
      }
      await sleep(3000);
      setAll("idle");
    } else {
      if (!outcome.fill) feel(leader, "sad");
      await sleep(2200);
    }
    await walkAll(AGENT_ORDER.filter((a) => at[a].kind !== "home"), HOME);
    if (outcome.own?.length) {
      emit({ type: "phase", phase: "execute" });
      await ownBooks(outcome.own);
      emit({ type: "phase", phase: "settle" });
    }
    return open.round;
  }

  // --- main loop ---

  (async () => {
    const first = await sync();
    for (const f of first?.fills ?? []) knownFills.add(f.id);
    // A count ahead of the server's means the desk was started afresh, and nothing has been watched yet.
    let seen = first && lastWatched() <= first.round ? lastWatched() : 0;
    // What the desk said before is put on the page at once, whoever is looking and from wherever.
    // The latest session is left out if it is about to be played.
    if (first && first.round > 0 && useArena.getState().history.oldest === null) {
      await loadHistory(emit, seen >= first.round ? first.round + 1 : first.round, signal).catch((e) => {
        if (signal.aborted) throw new Stopped();
        console.error("[council] could not load the desk's history:", e);
      });
    }

    for (;;) {
      let res: Response;
      try {
        res = await fetch("/api/council/round", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seen }),
          signal,
        });
      } catch {
        if (signal.aborted) return;
        await sleep(5000);
        continue;
      }

      if (!res.ok) {
        await sleep(8000);
      } else if (res.headers.get("content-type")?.includes("ndjson")) {
        const played = await playRound(res).finally(() => {
          playing = 0;
          shown = 0;
          watchedLines = 0;
        });
        seen = Math.max(seen, played);
        markWatched(played);
        await sync();
        // A round that broke early reports no number. Give the server a moment before asking again.
        if (played === 0) await sleep(10_000);
      } else {
        const { nextRoundAt } = (await res.json()) as RoundResponse;
        const snapshot = await sync();
        seen = Math.max(seen, snapshot?.round ?? 0);
        await monitor(nextRoundAt, snapshot ? snapshot.serverTime - Date.now() : 0);
      }
    }
  })().catch((e) => {
    if (!(e instanceof Stopped) && !signal.aborted) console.error("[council] show stopped:", e);
  });

  return () => ctrl.abort();
}
