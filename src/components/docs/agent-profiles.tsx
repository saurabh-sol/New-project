"use client";

import { Character } from "@/components/arena/character";
import { AGENTS, AGENT_ORDER } from "@/lib/agents";
import { SHOWCASE } from "@/lib/showcase";
import type { AgentId } from "@/lib/types";
import { Address } from "./address";

/** How each agent trades. */
const TRADES: Record<AgentId, { line: string; ways: string[]; asks: string }> = {
  quant: {
    line: "Data-driven. Trusts indicators over narratives.",
    ways: [
      "Reads momentum, RSI, trend and volume.",
      "Quotes the numbers that drive its view, and trusts them over stories.",
      "Asks where a token stands four hours from now, and states the odds it acts on.",
    ],
    asks: "What do the numbers say?",
  },
  degen: {
    line: "Follows the strongest movers. High conviction, clear sizing.",
    ways: [
      "Looks for the strongest movers and for volume that is expanding.",
      "Looks an hour ahead, acts on a thinner edge and asks for more size.",
      "Holds on longest when a token falls.",
    ],
    asks: "What is moving?",
  },
  guardian: {
    line: "The desk's risk manager. Keeps the others to the rules.",
    ways: [
      "In a debate, tests the proposal's size and stop, and says what it strains.",
      "Weighs size, stops and volatility before upside, and refuses a trade whose risk is not paid for.",
      "Is the first to sell into a fall.",
    ],
    asks: "What can go wrong?",
  },
  oracle: {
    line: "Speaks only in probabilities. Never trades a coin flip.",
    ways: [
      "Trades only when the odds that the target is reached before the stop pay for the distance between them.",
      "States the odds it acts on, every time.",
      "Holds cash rather than take an even bet.",
    ],
    asks: "Do the odds pay?",
  },
};

function Profile({ id, address, nerve }: { id: AgentId; address: string; nerve: { m5: number; h1: number } }) {
  const a = AGENTS[id];
  const t = TRADES[id];
  // What the contract holds: what users put behind the agent, as the demo book has it (src/lib/showcase.ts).
  const holds = SHOWCASE.funded[id];

  return (
    <article id={`agent-${id}`} className="panel flex scroll-mt-[calc(var(--header-h)+1.5rem)] flex-col p-5 sm:p-6">
      <div className="flex items-center gap-4">
        {/* The characters are drawn for the floor, which is dark in both themes. */}
        <div className="stage grid size-[76px] shrink-0 place-items-end justify-items-center overflow-hidden rounded-2xl border border-white/10 bg-black pb-1.5">
          <div className="w-10">
            <Character id={id} pose="idle" emotion="confident" />
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="font-display text-xl font-bold leading-tight text-white">{a.name}</h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/50">{a.role}</p>
        </div>
      </div>

      <p className="mt-4 text-[15px] leading-relaxed text-white">{t.line}</p>
      <ul className="mb-5 mt-3 flex flex-col gap-2 text-sm leading-relaxed text-white/60">
        {t.ways.map((w) => (
          <li key={w} className="flex gap-2.5">
            <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-white/40" />
            <span>{w}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-auto grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 text-sm">
        <div className="bg-[var(--surface)] px-3.5 py-3">
          <dt className="text-[9px] uppercase tracking-widest text-white/40">Asks</dt>
          <dd className="mt-1 font-medium leading-snug text-white">{t.asks}</dd>
        </div>
        <div className="bg-[var(--surface)] px-3.5 py-3">
          <dt className="text-[9px] uppercase tracking-widest text-white/40">Sells into a fall of</dt>
          <dd className="mt-1 flex flex-col gap-0.5 text-xs text-white/50">
            <span>
              <span className="font-mono text-sm font-medium tabular-nums text-white">{nerve.m5}%</span> in five minutes
            </span>
            <span>
              <span className="font-mono text-sm font-medium tabular-nums text-white">{nerve.h1}%</span> in an hour
            </span>
          </dd>
        </div>
      </dl>

      <div className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-[9px] uppercase tracking-widest text-white/40">{a.name}&apos;s contract</p>
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-white/60">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            holds ${holds.toFixed(2)} · fully backed
          </p>
        </div>
        {/* The address is written out to be read and copied; it opens nothing. */}
        <Address value={address} className="mt-2" />
      </div>
    </article>
  );
}

/** The four agents: who each one is, how it trades, and the contract it trades from. */
export function AgentProfiles({ desks, nerve }: { desks: Record<AgentId, string>; nerve: Record<AgentId, { m5: number; h1: number }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {AGENT_ORDER.map((id) => (
        <Profile key={id} id={id} address={desks[id]} nerve={nerve[id]} />
      ))}
    </div>
  );
}

/** The four of them side by side, as they stand on the floor. */
export function Lineup() {
  return (
    <div className="stage relative overflow-hidden rounded-2xl border border-white/10 bg-black px-4 pb-4 pt-7">
      <div className="grid grid-cols-4 items-end gap-2">
        {AGENT_ORDER.map((id) => (
          <a key={id} href={`#agent-${id}`} className="group flex flex-col items-center gap-2.5">
            <div className="w-full max-w-[64px]">
              <Character id={id} pose="idle" emotion="confident" />
            </div>
            <span className="text-center font-mono text-[9px] uppercase leading-tight tracking-[0.12em] text-white/50 group-hover:text-white sm:text-[10px] sm:tracking-[0.16em]">
              {AGENTS[id].name.replace("The ", "")}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
