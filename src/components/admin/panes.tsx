"use client";

import type { ReactNode } from "react";
import type { AdminStatus } from "@/lib/admin-types";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { holders, unrealized, type Position } from "@/lib/council";
import { SHOWCASE_AGENT_CAPITAL } from "@/lib/showcase";
import { useShowcaseBook } from "@/lib/use-showcase";
import type { AgentId, AgentState } from "@/lib/types";
import { cn, fmtPrice, fmtSigned, shortAddress } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useMarket } from "@/store/market";
import { useModelName, usePrices, useWatched } from "@/store/selectors";
import { Pane } from "./pane";

const short = (id: AgentId) => AGENTS[id].name.replace("The ", "").toUpperCase();
const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
const gain = (n: number) => (n > -0.005 ? "text-green-400" : "text-red-400");

export function span(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return hours < 48 ? `${hours}h ${mins % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// --- positions ---

/** Positions a screen has room for. The rest are counted. */
const POSITIONS_SHOWN = 5;
const CELLS = 24;

/** Where the price sits between the stop and the target, drawn in characters: `|` is the entry, `●` the price now. */
function gauge(pos: Position, price: number): string {
  const at = (p: number) => Math.min(CELLS - 1, Math.max(0, Math.round(((p - pos.stop) / (pos.target - pos.stop)) * (CELLS - 1))));
  const cells = Array.from({ length: CELLS }, () => "·");
  cells[at(pos.entryPrice)] = "|";
  cells[at(price)] = "●";
  return cells.join("");
}

function PositionLines({ pos, price, now }: { pos: Position; price: number; now: number | null }) {
  const pnl = unrealized(pos, price);
  const pct = pos.cost > 0 ? (pnl / pos.cost) * 100 : 0;
  return (
    <li>
      <div className="grid grid-cols-[minmax(6ch,1fr)_9ch_minmax(0,26ch)_18ch] gap-x-[1ch] whitespace-nowrap">
        <span className="truncate font-bold text-white">{pos.token}</span>
        <span className="text-right text-white/85">${pos.cost.toFixed(2)}</span>
        <span className="truncate text-right text-white/50">
          {fmtPrice(pos.entryPrice)} -&gt; <span className="text-white/85">{fmtPrice(price)}</span>
        </span>
        <span className={cn("text-right", gain(pnl))}>
          {fmtSigned(pnl)} ({pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%)
        </span>
      </div>
      <div className="flex gap-x-[1ch] whitespace-nowrap text-white/35">
        <span className="text-red-400/80">stop</span>
        <span className="text-white/60">{gauge(pos, price)}</span>
        <span>target</span>
        <span className="truncate">
          · {holders(pos).map((a) => `${short(a).slice(0, 3)} $${pos.stake[a].toFixed(0)}`).join(" ")}
          {now !== null && ` · held ${span(now - pos.openedAt)}`}
        </span>
      </div>
    </li>
  );
}

export function PositionsPane({ now, className }: { now: number | null; className?: string }) {
  const portfolio = useArena((s) => s.portfolio);
  const prices = usePrices();
  const book = useShowcaseBook();
  const shown = portfolio.positions.slice(0, POSITIONS_SHOWN);
  const more = portfolio.positions.length - shown.length;

  return (
    <Pane title="positions" command="positions --open" aside={`cash $${book.equity.toFixed(2)}`} className={className}>
      <ul>
        {shown.map((pos) => (
          <PositionLines key={pos.token} pos={pos} price={prices[pos.token] ?? pos.entryPrice} now={now} />
        ))}
      </ul>
      {more > 0 && <div className="text-white/35">… and {more} more</div>}
      {portfolio.positions.length === 0 && <div className="text-white/35">nothing held. the desk is all in cash.</div>}
    </Pane>
  );
}

// --- agents ---

const DOING: Record<AgentState, string> = {
  idle: "",
  thinking: "analysing",
  speaking: "speaking",
  negotiating: "committing",
  voting: "voting",
  executing: "sending order",
  win: "booked a gain",
  loss: "booked a loss",
};

function AgentCell({ id, rank }: { id: AgentId; rank: number }) {
  const model = useModelName(id);
  const state = useArena((s) => s.agents[id].state);
  const portfolio = useArena((s) => s.portfolio);
  const desk = useArena((s) => s.desk?.agents[id]);

  // The demo book's figures for the agent (src/lib/showcase.ts), moved by its own trades.
  const book = useShowcaseBook();
  const pnl = book.result(id);
  const pct = book.pct(id);
  const inTrades = portfolio.positions.reduce((t, p) => t + p.stake[id], 0);
  const cash = SHOWCASE_AGENT_CAPITAL + pnl - inTrades;

  return (
    <div className="min-w-0 border border-white/15 px-[1ch] py-1">
      <div className="flex items-baseline justify-between gap-2 whitespace-nowrap">
        <span className="truncate font-bold text-white">
          <span className="mr-[1ch] inline-block size-[0.6em] rounded-full align-middle" style={{ background: AGENTS[id].color }} />
          {short(id)}
        </span>
        <span className="text-white/35">#{rank}</span>
      </div>
      <div className="truncate text-white/45">
        {model.toLowerCase()}
        {state !== "idle" && <span className="text-white"> · {DOING[state]}</span>}
      </div>
      <div className={cn("whitespace-nowrap", gain(pnl))}>
        {fmtSigned(pnl)} <span className="opacity-75">({pct >= 0 ? "+" : ""}{pct.toFixed(2)}%)</span>
      </div>
      <div className="truncate text-white/55">
        cash ${cash.toFixed(2)} in ${inTrades.toFixed(2)}
      </div>
      {desk && (
        <a href={desk.explorerAddress} target="_blank" rel="noreferrer" className="block truncate text-white/40 hover:text-white">
          {shortAddress(desk.address)}
          {` · $${(SHOWCASE_AGENT_CAPITAL + pnl).toFixed(2)}`}
          {desk.solvent !== null && (desk.solvent ? " · ok" : "")}
          {desk.solvent === false && <span className="text-red-400"> · SHORT</span>}
        </a>
      )}
    </div>
  );
}

/** One cell per agent, best result first. */
export function AgentsStrip() {
  const book = useShowcaseBook();
  const ranked = [...AGENT_ORDER].sort((x, y) => book.result(y) - book.result(x));
  return (
    <section aria-label="The agents" className="grid shrink-0 grid-cols-2 gap-2 xl:grid-cols-4">
      {ranked.map((id, i) => (
        <AgentCell key={id} id={id} rank={i + 1} />
      ))}
    </section>
  );
}

// --- system ---

function Row({ name, bad, children }: { name: string; bad?: boolean; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10ch_minmax(0,1fr)] gap-x-[1ch] whitespace-nowrap">
      <dt className="text-white/35">{name}</dt>
      <dd className={cn("truncate", bad ? "text-red-400" : "text-white/80")}>{children}</dd>
    </div>
  );
}

/** Below this the treasury can't be relied on to pay for the gas of recording trades. */
const LOW_GAS = 0.002;

export function SystemPane({ status, reached, now, className }: { status: AdminStatus | null; reached: boolean; now: number | null; className?: string }) {
  const mode = useArena((s) => s.mode);
  const note = useArena((s) => s.modeNote);
  const ready = useArena((s) => s.ready);
  const desk = useArena((s) => s.desk);
  const fills = useArena((s) => s.fills);
  const feed = useMarket((s) => s.status);
  const watched = useWatched();

  const waiting = desk ? fills.filter((f) => f.ts >= desk.since && !f.tx && !f.txs && !f.unrecorded).length : 0;
  const lost = desk ? fills.filter((f) => f.unrecorded).length : 0;
  const t = status?.treasury;
  const ago = (ts: number | null) => (ts && now ? `${clock(ts)} (${span(now - ts)} ago)` : "—");

  return (
    <Pane title="system" command="status" aside={reached ? (status ? `signed in as ${status.user}` : "asking…") : "SERVER NOT REACHED"} className={className}>
      <dl>
        <Row name="agents" bad={mode !== "live"}>
          {/* Why they are, the next line says. Without it, the server's own words are shown. */}
          {!ready ? "asking…" : mode === "live" ? "on their AI models" : status || !note ? "scripted stand-ins, not their AI models" : note}
        </Row>
        {status && (
          <>
            <Row name="gateway" bad={!status.gateway.hasKey || status.gateway.outOfBudget || mode !== "live" || status.sessions.today >= status.sessions.perDay}>
              {/* A server that has just started has not been refused yet, so scripted agents are not called "answering". */}
              {!status.gateway.hasKey ? "no key set" : status.gateway.outOfBudget ? "budget used up · raise it in Vercel" : mode === "live" ? "answering" : "did not answer the last session"} · {status.sessions.today} of {status.sessions.perDay} sessions today
              {status.sessions.today >= status.sessions.perDay ? " · the day's limit is reached" : ""}
            </Row>
            <Row name="last run">
              session {ago(status.sessions.lastAt)} · risk check {ago(status.sessions.lastRiskCheck)}
            </Row>
          </>
        )}
        <Row name="prices" bad={feed === "down"}>
          {feed === "live" ? `live · ${watched.length} tokens watched` : feed === "down" ? "feed not reached" : "loading"}
        </Row>
        <Row name="contracts" bad={desk?.solvent === false || lost > 0}>
          {desk
            ? `${desk.network} · ${desk.solvent === null ? "not read" : desk.solvent ? "all hold what they owe" : "ONE HOLDS LESS THAN IT OWES"}${desk.holds !== null ? ` · $${desk.holds.toFixed(2)}` : ""}${waiting ? ` · ${waiting} recording` : ""}${lost ? ` · ${lost} not recorded` : ""}`
            : "none deployed · trades are kept in the books only"}
        </Row>
        {t && (
          <Row name="treasury" bad={t.gas !== null && t.gas < LOW_GAS}>
            {shortAddress(t.address)} · gas {t.gas === null ? "?" : `${t.gas.toFixed(4)} ETH`}
            {t.gas !== null && t.gas < LOW_GAS ? " LOW" : ""} · {t.usdg === null ? "?" : `${t.usdg.toFixed(2)} USDG`}
          </Row>
        )}
        {status && (
          <Row name="server" bad={!status.database}>
            {status.version ?? "local"} · up {now ? span(now - status.startedAt) : "—"} · {status.database ? "database ok" : "NO DATABASE"}
          </Row>
        )}
      </dl>
    </Pane>
  );
}
