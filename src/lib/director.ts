/**
 * Plays council sessions in the browser. The server decides what the agents say and
 * do; this file decides how it is staged: who walks where, and how long each line is held.
 */
import { AGENT_ORDER, AGENTS } from "./agents";
import type { DeskAsset } from "./assets";
import { agentPnl, type Emotion, type Fill } from "./council";
import type { CouncilSnapshot, Line, RoundResponse, Stage } from "./council-types";
import { walkSeconds } from "./layout";
import type { AgentId, AgentState, ArenaEvent, MessageKind, Spot } from "./types";
import { fmtPrice, fmtSigned } from "./utils";
import { livePrices, useMarket } from "@/store/market";

const HOME: Spot = { kind: "home" };
const TABLE: Spot = { kind: "table" };
const SETTLE_MS = 250;
const POLL_MS = 15_000;

class Stopped extends Error {}

const uid = () => Math.random().toString(36).slice(2, 10);

/** Passes the server's prices for requested tokens to everything on the page that shows a price. */
function learn(assets: Record<string, DeskAsset>) {
  const quotes = Object.fromEntries(Object.values(assets).map((a) => [a.key, { price: a.quote.price, change24h: a.quote.change24h }]));
  if (Object.keys(quotes).length) useMarket.getState().setAssetQuotes(quotes);
}
/** Time a speech bubble needs to type out, plus a beat to read it. */
const readTime = (text: string) => Math.min(text.length * 26 + 1400, 5000);

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

  // --- staging primitives ---

  /** Waits, holding the show while the tab is hidden (browsers freeze animations there). */
  async function sleep(ms: number) {
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
  const system = (text: string, agent: AgentId = "guardian") =>
    emit({ type: "message", message: { id: uid(), agent, kind: "system", text, ts: Date.now() } });

  /** Starts a walk and returns how long it takes, in ms. */
  function walk(agent: AgentId, to: Spot): number {
    const ms = walkSeconds(agent, at[agent], to) * 1000;
    emit({ type: "move", agent, to });
    at[agent] = to;
    return ms;
  }
  const walkAndWait = async (agent: AgentId, to: Spot) => sleep(walk(agent, to) + SETTLE_MS);
  const walkAll = async (agents: AgentId[], to: Spot) => sleep(Math.max(0, ...agents.map((a) => walk(a, to))) + SETTLE_MS);

  async function say(line: Line, kind: MessageKind) {
    feel(line.agent, line.emotion);
    setState(line.agent, "speaking");
    emit({
      type: "message",
      message: { id: uid(), agent: line.agent, to: line.to, kind, text: line.say, ts: Date.now(), emotion: line.emotion, source: line.source },
    });
    await sleep(readTime(line.say));
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
          if (fill.reason !== "COUNCIL") await riskExit(fill, snapshot);
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

  async function playRound(res: Response): Promise<number> {
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
    emit({ type: "round_start", round: open.round, mode: open.mode, portfolio: open.portfolio });
    emit({ type: "phase", phase: "scan" });
    const away = AGENT_ORDER.filter((a) => at[a].kind !== "home");
    if (away.length) await walkAll(away, HOME);
    AGENT_ORDER.forEach((a) => feel(a, "neutral"));
    setAll("thinking");
    system(`Session ${open.round} opens. The desk is reading the market.`);
    const scanStarted = Date.now();

    const request = open.request ?? null;
    if (request) {
      const seen = open.stats.find((s) => s.token === request.asset.key);
      const quote = { price: seen?.price ?? 0, change24h: seen?.change24h ?? 0, liquidityUsd: request.liquidityUsd, volume24hUsd: request.volume24hUsd };
      const asset: DeskAsset = { ...request.asset, quote, quotedAt: Date.now() };
      emit({ type: "assets", assets: { [asset.key]: asset } });
      if (seen) learn({ [asset.key]: asset });
      const who = AGENTS[request.agent].name;
      system(
        request.mode === "commit"
          ? `A funder put $${request.usd.toFixed(0)} behind ${who} and asked for ${request.asset.key}. ${who} is committed to the trade. The others decide whether to join.`
          : `A funder put $${request.usd.toFixed(0)} behind ${who} and asked for ${request.asset.key}. ${who} presents it once, and the council votes.`,
        request.agent,
      );
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
      return open.round;
    }
    const leader = proposal.leader;
    const buying = proposal.action === "BUY";
    emit({ type: "focus", token: proposal.token });
    system(
      request && proposal.token === request.asset.key
        ? `${AGENTS[leader].name} puts the funder's request to the desk: buy ${proposal.token}.`
        : buying
        ? `${AGENTS[leader].name} leads with a proposal to buy ${proposal.token}.`
        : `${AGENTS[leader].name} leads with a proposal to sell ${proposal.sellPct}% of the desk's ${proposal.token}.`,
      leader,
    );

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
          message: { id: uid(), agent: pledge.agent, to: leader, kind: "negotiate", text: pledge.say, ts: Date.now(), emotion: pledge.emotion, source: pledge.source },
        });
        await sleep(1400);
        emit({ type: "offer", id: uid(), from: pledge.agent, to: leader, amount: pledge.stakeUsd });
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
    let yes = 0;
    for (const v of decision.votes) {
      if (v.approve) yes++;
      setState(v.agent, "voting");
      await sleep(500);
      emit({ type: "vote", agent: v.agent, approve: v.approve, reason: v.reason });
      emit({ type: "message", message: { id: uid(), agent: v.agent, kind: "vote", text: `${v.approve ? "YES" : "NO"}: ${v.reason}`, ts: Date.now() } });
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
    return open.round;
  }

  // --- main loop ---

  (async () => {
    let seen = 0;
    const first = await sync();
    for (const f of first?.fills ?? []) knownFills.add(f.id);

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
        const played = await playRound(res);
        seen = Math.max(seen, played);
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
