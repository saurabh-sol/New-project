/** What the server sends the browser about a council session. */
import type { Emotion, Fill, Portfolio } from "./council";
import type { Token } from "./market";
import type { AgentId } from "./types";

/** model: written by the AI model. scripted: rule-based stand-in, used when a model can't be reached. */
export type Source = "model" | "scripted";

export interface TokenStats {
  token: Token;
  price: number;
  change24h: number; // percent
  change1h: number; // percent
  rsi14: number; // on 5-minute candles
  /** Volume of the last 15 minutes against the average of the two hours before. */
  volRatio: number;
  high1h: number;
  low1h: number;
}

export interface Pitch {
  agent: AgentId;
  action: "BUY" | "SELL" | "HOLD";
  token: Token;
  stakeUsd: number;
  stopPct: number;
  targetPct: number;
  conviction: number; // 1..5
  emotion: Emotion;
  say: string;
  source: Source;
}

export interface Proposal {
  leader: AgentId;
  action: "BUY" | "SELL";
  token: Token;
  stopPct: number;
  targetPct: number;
  /** Share of the position to sell. Only used for SELL. */
  sellPct: number;
}

export interface Line {
  agent: AgentId;
  to?: AgentId;
  emotion: Emotion;
  say: string;
  source: Source;
}

export interface Exchange {
  challenge: Line;
  reply: Line;
}

export interface Pledge extends Line {
  support: boolean;
  stakeUsd: number;
  /** Short reason shown with the vote. */
  reason: string;
}

export interface Vote {
  agent: AgentId;
  approve: boolean;
  reason: string;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export type CouncilMode = "live" | "scripted";

export type Stage =
  | { stage: "open"; round: number; mode: CouncilMode; stats: TokenStats[]; portfolio: Portfolio; startedAt: number }
  | { stage: "pitches"; pitches: Pitch[]; proposal: Proposal | null }
  | { stage: "debate"; exchanges: Exchange[] }
  | { stage: "decision"; pledges: Pledge[]; closing: Line; votes: Vote[]; approved: boolean }
  | { stage: "outcome"; fill: Fill | null; portfolio: Portfolio; note: string }
  | { stage: "error"; message: string };

export interface CouncilSnapshot {
  mode: CouncilMode;
  /** Why the council is not running on live models, when it isn't. */
  modeNote: string | null;
  models: Record<AgentId, ModelInfo>;
  round: number;
  portfolio: Portfolio;
  fills: Fill[];
  nextRoundAt: number;
  intervalMs: number;
  serverTime: number;
}

export type RoundResponse = { wait: number; nextRoundAt: number };
