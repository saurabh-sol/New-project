"use client";

import { AGENTS } from "@/lib/agents";
import type { Emotion } from "@/lib/council";
import type { AgentId } from "@/lib/types";
import { Character } from "./character";

/** An agent's face in a circle, cropped from the full character. `size` is in pixels. */
export function Face({ id, size = 32, emotion = "neutral" }: { id: AgentId; size?: number; emotion?: Emotion }) {
  const color = AGENTS[id].color;
  return (
    <span
      className="relative block shrink-0 overflow-hidden rounded-full"
      style={{ width: size, height: size, background: `${color}1f`, boxShadow: `inset 0 0 0 1px ${color}66` }}
    >
      <span className="absolute block" style={{ width: size * 1.62, left: -size * 0.31, top: size * 0.03 }}>
        <Character id={id} pose="idle" emotion={emotion} />
      </span>
    </span>
  );
}
