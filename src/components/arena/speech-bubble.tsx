"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { AGENTS } from "@/lib/agents";
import type { ChatMessage } from "@/lib/types";

const KIND_LABEL: Record<string, string> = {
  pitch: "PITCH",
  debate: "DEBATE",
  negotiate: "OFFER",
  vote: "VOTE",
};

/** Types the text out character by character. Remount (via key) to restart. */
function useTypewriter(text: string, msPerChar = 20) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, msPerChar);
    return () => clearInterval(id);
  }, [text, msPerChar]);
  return text.slice(0, n);
}

/** Renders "@Name" mentions in bold. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(@\w+)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (!p.startsWith("@")) return <span key={i}>{p}</span>;
        return (
          <span key={i} className="font-semibold text-white">
            {p}
          </span>
        );
      })}
    </>
  );
}

/** `tail` is where the pointer sits along the bottom edge, in %. */
export function SpeechBubble({ message, tail }: { message: ChatMessage; tail: number }) {
  const agent = AGENTS[message.agent];
  const typed = useTypewriter(message.text);
  const done = typed.length >= message.text.length;

  return (
    <motion.div
      className="relative rounded-2xl border border-white/30 bg-black/95 px-3.5 py-2.5 text-[13px] leading-snug text-white/90 shadow-2xl backdrop-blur-xl"
      style={{ transformOrigin: `${tail}% 100%` }}
      initial={{ opacity: 0, scale: 0.5, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
    >
      <div className="mb-1 flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-white">
        <span>{agent.name.toUpperCase()}</span>
        <span className="text-white/35">{KIND_LABEL[message.kind] ?? message.kind.toUpperCase()}</span>
        {message.to && (
          <span className="text-white/40">
            → <span className="text-white/70">{AGENTS[message.to].name.replace("The ", "").toUpperCase()}</span>
          </span>
        )}
      </div>
      <p>
        <Highlighted text={typed} />
        {!done && (
          <motion.span
            className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5"
            style={{ background: "#fff" }}
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
          />
        )}
      </p>
      <span
        className="absolute top-full size-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/30 bg-black"
        style={{ left: `${tail}%` }}
      />
    </motion.div>
  );
}
