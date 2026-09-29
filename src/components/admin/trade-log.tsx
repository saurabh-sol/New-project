"use client";

import { useEffect, useRef } from "react";
import { AGENTS, AGENT_ORDER, withPresentNames } from "@/lib/agents";
import { explorerLink, type DeskInfo } from "@/lib/chains";
import type { Fill } from "@/lib/council";
import { cn, fmtPrice, fmtSigned } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { Pane } from "./pane";

/** As many trades as a screen can show at once, and then some to scroll back through. */
const SHOWN = 80;

const TRIGGER: Record<Fill["reason"], string> = { COUNCIL: "council", OWN: "own", STOP: "stop", TARGET: "target", FALLING: "falling" };

const COLUMNS = "grid grid-cols-[8ch_4ch_minmax(6ch,1fr)_9ch_13ch_10ch_7ch_9ch_4ch] gap-x-[1ch]";

const clock = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
const short = (name: string) => name.replace("The ", "").toUpperCase();
/** A note opens by saying who sold what and at what price, which the line above it has said already. */
const reason = (note: string) => withPresentNames(note.includes(": ") ? note.slice(note.indexOf(": ") + 2) : note);

/** How many of the agents in a trade have it on record on their own contract. */
function onChain(f: Fill, desk: DeskInfo | null): { text: string; href: string | null; bad: boolean } | null {
  if (!desk) return null;
  const parts = AGENT_ORDER.filter((a) => f.stake[a] > 0.005).length || 1;
  const done = f.txs ? Object.keys(f.txs).length : f.tx ? 1 : 0;
  const first = f.tx ?? (f.txs ? Object.values(f.txs)[0] : undefined);
  if (done === 0 && (f.unrecorded || f.ts < desk.since)) return { text: "—", href: null, bad: !!f.unrecorded };
  return { text: `${Math.min(done, parts)}/${parts}`, href: first ? explorerLink(desk, first) : null, bad: false };
}

function Line({ f, desk }: { f: Fill; desk: DeskInfo | null }) {
  const chain = onChain(f, desk);
  return (
    <li>
      <div className={cn(COLUMNS, "whitespace-nowrap")}>
        <span className="text-white/40">{clock(f.ts)}</span>
        <span className={cn("font-bold", f.side === "BUY" ? "text-green-400" : "text-red-400")}>{f.side}</span>
        <span className="truncate text-white">{f.token}</span>
        <span className="text-right text-white/85">${f.usd.toFixed(2)}</span>
        <span className="truncate text-right text-white/50">@{fmtPrice(f.price)}</span>
        <span className="truncate text-white/70">{short(AGENTS[f.leader].name)}</span>
        <span className="text-white/45">{TRIGGER[f.reason]}</span>
        <span className={cn("text-right", f.realized === null ? "text-white/25" : f.realized >= 0 ? "text-green-400" : "text-red-400")}>{f.realized === null ? "open" : fmtSigned(f.realized)}</span>
        {chain &&
          (chain.href ? (
            <a href={chain.href} target="_blank" rel="noreferrer" className="text-right text-white/60 hover:text-white">
              {chain.text}
            </a>
          ) : (
            <span className={cn("text-right", chain.bad ? "text-red-400" : "text-white/30")}>{chain.text}</span>
          ))}
      </div>
      {f.note && <div className="truncate pl-[9ch] text-white/35">└ {reason(f.note)}</div>}
    </li>
  );
}

/** The desk's trades as a terminal shows a log: oldest at the top, the newest written at the bottom. */
export function TradeLog({ className }: { className?: string }) {
  const fills = useArena((s) => s.fills);
  const desk = useArena((s) => s.desk);
  const ready = useArena((s) => s.ready);
  const end = useRef<HTMLDivElement>(null);

  // The store keeps the newest first.
  const lines = fills.slice(0, SHOWN).reverse();
  const newest = fills[0]?.id;
  useEffect(() => {
    const box = end.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [newest, lines.length]);

  return (
    <Pane title="trades.log" command="tail -f trades.log" aside={`${fills.length} on record${desk ? " · chain = agents' contracts holding the trade" : ""}`} className={className}>
      {/* A screen too narrow for a whole line is moved sideways, as a terminal's window would be. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto [scrollbar-width:none]">
        <div className="flex min-h-0 min-w-[78ch] flex-1 flex-col">
          <div className={cn(COLUMNS, "shrink-0 border-b border-white/10 pb-0.5 uppercase text-white/30")}>
            <span>time</span>
            <span>side</span>
            <span>token</span>
            <span className="text-right">size</span>
            <span className="text-right">price</span>
            <span>led by</span>
            <span>why</span>
            <span className="text-right">result</span>
            {desk && <span className="text-right">chain</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pt-1 [scrollbar-width:none]">
            <ul className="flex min-h-full flex-col justify-end">
              {lines.map((f) => (
                <Line key={f.id} f={f} desk={desk} />
              ))}
              <li className="text-white/40">
                {ready && fills.length === 0 ? "no trades yet. the council trades when three of four agree. " : ""}
                <span className="cursor-blink text-white">█</span>
              </li>
            </ul>
            <div ref={end} />
          </div>
        </div>
      </div>
    </Pane>
  );
}
