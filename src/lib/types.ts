import type { DeskAsset } from "./assets";
import type { Emotion, Fill, Portfolio } from "./council";
import type { CouncilMode, CouncilSnapshot, Source } from "./council-types";
import type { AssetKey } from "./market";

export type AgentId = "quant" | "guardian" | "degen" | "oracle";

export type AgentState =
  | "idle"
  | "thinking"
  | "speaking"
  | "negotiating"
  | "voting"
  | "executing"
  | "win"
  | "loss";

/** `monitor` is the quiet stretch between council sessions. */
export type Phase = "monitor" | "scan" | "pitch" | "debate" | "negotiate" | "vote" | "execute" | "settle";

export type MessageKind = "pitch" | "debate" | "negotiate" | "vote" | "closing" | "system";

/** A point on the trading floor, in % of the arena box. */
export type Pt = { x: number; y: number };

/** Where an agent stands: own desk, visiting another agent's desk, or at the council table. */
export type Spot = { kind: "home" } | { kind: "desk"; of: AgentId } | { kind: "table" };

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: string;
  /** Default labels. The server's configured model names replace these once loaded. */
  model: string;
  provider: string;
  color: string; // accent, used for glows, eyes and coins
  body: string;
  bodyShade: string;
  head: string;
  headShade: string;
  persona: string;
}

export interface ChatMessage {
  id: string;
  agent: AgentId;
  to?: AgentId;
  kind: MessageKind;
  text: string;
  ts: number;
  emotion?: Emotion;
  /** Whether the AI model wrote this line or the scripted stand-in did. */
  source?: Source;
}

export type ArenaEvent =
  | { type: "sync"; snapshot: CouncilSnapshot }
  | { type: "round_start"; round: number; mode: CouncilMode; portfolio: Portfolio }
  | { type: "phase"; phase: Phase }
  | { type: "focus"; token: AssetKey | null }
  /** Tokens funders asked for that the desk has just learned of. */
  | { type: "assets"; assets: Record<AssetKey, DeskAsset> }
  | { type: "agent_state"; agent: AgentId; state: AgentState }
  | { type: "emotion"; agent: AgentId; emotion: Emotion }
  | { type: "move"; agent: AgentId; to: Spot }
  | { type: "message"; message: ChatMessage }
  | { type: "offer"; id: string; from: AgentId; to: AgentId; amount: number }
  | { type: "vote"; agent: AgentId; approve: boolean; reason: string }
  | { type: "consensus"; value: number } // 0..1
  | { type: "fill"; fill: Fill; portfolio: Portfolio }
  | { type: "schedule"; nextRoundAt: number };
