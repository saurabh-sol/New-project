"use client";

import { animate, AnimatePresence, motion, useMotionValue, useMotionValueEvent, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { facingAt, homePoint, inward, routeBetween, routeDuration, routeTimes, sameSpot } from "@/lib/layout";
import type { AgentId, AgentState, Spot } from "@/lib/types";
import { useArena } from "@/store/arena";
import { shortModel, useModelName } from "@/store/selectors";
import { Character, type Pose } from "./character";

const POSE: Record<AgentState, Pose> = {
  idle: "idle",
  thinking: "type",
  speaking: "talk",
  negotiating: "idle",
  voting: "vote",
  executing: "exec",
  win: "cheer",
  loss: "slump",
};

/** A character that walks across the floor whenever its spot changes. */
export function AgentActor({ id, index }: { id: AgentId; index: number }) {
  const spot = useArena((s) => s.agents[id].spot);
  const state = useArena((s) => s.agents[id].state);
  const walking = useArena((s) => s.agents[id].walking);
  const emotion = useArena((s) => s.agents[id].emotion);
  const model = useModelName(id);
  const arrive = useArena((s) => s.arrive);

  const home = homePoint(id);
  const x = useMotionValue(home.x);
  const y = useMotionValue(home.y);
  const left = useTransform(x, (v) => `${v}%`);
  const top = useTransform(y, (v) => `${v}%`);
  // Further down the floor means closer to the camera.
  const zIndex = useTransform(y, (v) => Math.round(v * 10));
  const [facing, setFacing] = useState<1 | -1>(inward(id));
  const prevSpot = useRef<Spot>(spot);

  useMotionValueEvent(x, "change", () => {
    const v = x.getVelocity();
    if (Math.abs(v) > 2) setFacing(v > 0 ? 1 : -1);
  });

  useEffect(() => {
    const from = prevSpot.current;
    prevSpot.current = spot;
    if (sameSpot(from, spot)) return;

    const pts = routeBetween(id, from, spot, { x: x.get(), y: y.get() });
    const opts = { duration: routeDuration(pts), times: routeTimes(pts), ease: "linear" as const };
    let cancelled = false;
    const ax = animate(x, pts.map((p) => p.x), opts);
    const ay = animate(y, pts.map((p) => p.y), opts);
    ax.then(() => {
      if (cancelled) return;
      setFacing(facingAt(id, spot));
      arrive(id);
    });
    return () => {
      cancelled = true;
      ax.stop();
      ay.stop();
    };
  }, [id, spot, x, y, arrive]);

  const pose: Pose = walking ? (state === "negotiating" ? "carry" : "walk") : POSE[state];

  return (
    <motion.div className="absolute" style={{ left, top, zIndex, width: "var(--char-w)", x: "-50%", y: "-100%" }}>
      <motion.div
        initial={{ opacity: 0, y: -40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 + index * 0.12, type: "spring", stiffness: 180, damping: 14 }}
      >
        <motion.div animate={{ scaleX: facing }} transition={{ duration: 0.18 }}>
          <Character id={id} pose={pose} emotion={emotion} facing={facing} thinking={state === "thinking" && !walking} />
        </motion.div>
      </motion.div>

      {/* win / loss burst */}
      <AnimatePresence>
        {(state === "win" || state === "loss") && (
          <motion.div key={state} className="pointer-events-none absolute inset-x-0 top-1/4" exit={{ opacity: 0 }}>
            {Array.from({ length: 14 }, (_, i) => {
              const a = (i / 14) * Math.PI * 2;
              return (
                <motion.span
                  key={i}
                  className="absolute left-1/2 top-1/2 size-1.5 rounded-full"
                  style={{ background: state === "win" ? "#4ade80" : "#f87171" }}
                  initial={{ x: 0, y: 0, opacity: 1 }}
                  animate={{ x: Math.cos(a) * 60, y: Math.sin(a) * 60 - 10, opacity: 0 }}
                  transition={{ duration: 1, ease: "easeOut", repeat: state === "win" ? 2 : 0 }}
                />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* name tag under the feet, only while away from the desk (which has its own nameplate) */}
      <AnimatePresence>
        {(walking || spot.kind !== "home") && (
          <motion.div
            className="absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full border bg-black/70 px-1.5 py-px font-mono text-[9px] font-semibold tracking-wider"
            style={{ color: "#fff", borderColor: "rgba(255,255,255,0.35)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {shortModel(model)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
