"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { AGENTS } from "@/lib/agents";
import { useArena } from "@/store/arena";

export function Transcript() {
  const messages = useArena((s) => s.messages);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03]">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <h2 className="font-mono text-[11px] tracking-[0.25em] text-white/50">COUNCIL TRANSCRIPT</h2>
        <span className="flex items-center gap-1.5 text-[10px] text-white/40">
          <span className="size-1.5 animate-pulse rounded-full bg-green-400" /> live
        </span>
      </div>
      <div ref={ref} className="h-80 space-y-2.5 overflow-y-auto px-4 py-3">
        <AnimatePresence initial={false}>
          {messages.map((m) => {
            const a = AGENTS[m.agent];
            if (m.kind === "system") {
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-sky-400/20 bg-sky-400/5 px-3 py-1.5 font-mono text-[11px] text-sky-200/80"
                >
                  {m.text}
                </motion.div>
              );
            }
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
                className="border-l-2 pl-3"
                style={{ borderColor: a.color }}
              >
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="font-semibold" style={{ color: a.color }}>
                    {a.name}
                  </span>
                  {m.to && (
                    <>
                      <span className="text-white/30">→</span>
                      <span style={{ color: AGENTS[m.to].color }}>{AGENTS[m.to].name}</span>
                    </>
                  )}
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-white/30">
                    {m.source === "scripted" && (
                      <span className="rounded bg-amber-400/10 px-1 text-amber-300/90" title="The model could not be reached, so a scripted stand-in spoke this line">
                        scripted
                      </span>
                    )}
                    {m.emotion && m.emotion !== "neutral" && <span>{m.emotion}</span>}
                    <span>{m.kind}</span>
                  </span>
                </div>
                <p className="mt-0.5 text-[13px] leading-snug text-white/75">{m.text}</p>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
