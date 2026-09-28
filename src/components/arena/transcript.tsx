"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { AGENTS } from "@/lib/agents";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { Face } from "./face";

const KIND: Record<string, string> = { pitch: "Pitch", debate: "Debate", negotiate: "Pledge", closing: "Closing", vote: "Vote" };
const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Line({ m }: { m: ChatMessage }) {
  const a = AGENTS[m.agent];

  if (m.kind === "system") {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 py-1 text-[11px] text-white/70">
        <span className="h-px flex-1 bg-white/15" />
        <span className="max-w-[80%] text-center font-mono">{m.text}</span>
        <span className="h-px flex-1 bg-white/15" />
      </motion.div>
    );
  }

  if (m.kind === "vote") {
    const yes = m.text.startsWith("YES");
    return (
      <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2.5 pl-1 text-xs">
        <Face id={m.agent} size={22} />
        <span className="font-medium text-white">
          {a.name}
        </span>
        <span className={cn("rounded-full px-2 py-px font-mono text-[10px] font-bold", yes ? "bg-white/15 text-white/80" : "bg-white/15 text-red-300")}>
          {yes ? "YES" : "NO"}
        </span>
        <span className="truncate text-white/50">{m.text.replace(/^(YES|NO): /, "")}</span>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", stiffness: 260, damping: 24 }} className="flex gap-3">
      <Face id={m.agent} size={34} emotion={m.emotion} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-white">
            {a.name}
          </span>
          {m.to && (
            <span className="text-white/40">
              to <span className="text-white/70">{AGENTS[m.to].name}</span>
            </span>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider text-white/30">{KIND[m.kind] ?? m.kind}</span>
          {m.source === "scripted" && (
            <span className="rounded bg-white/10 px-1 font-mono text-[10px] text-white/90" title="The model could not be reached, so a scripted stand-in spoke this line">
              scripted
            </span>
          )}
          <span className="ml-auto font-mono text-[10px] text-white/25">{time(m.ts)}</span>
        </div>
        <p className="mt-1 rounded-2xl rounded-tl-md border border-white/5 bg-white/[0.04] px-3.5 py-2 text-[13px] leading-relaxed text-white/85">{m.text}</p>
      </div>
    </motion.div>
  );
}

export function Transcript({ className = "h-96" }: { className?: string }) {
  const messages = useArena((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="panel flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3.5">
        <h2 className="panel-title">Desk conversation</h2>
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-white/40">
          <span className="size-1.5 animate-pulse rounded-full bg-white" /> live
        </span>
      </div>
      <div ref={ref} className={cn("space-y-3.5 overflow-y-auto px-5 py-4", className)}>
        {messages.length === 0 && <p className="py-10 text-center text-sm text-white/30">The desk is quiet. The next session will appear here.</p>}
        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <Line key={m.id} m={m} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
