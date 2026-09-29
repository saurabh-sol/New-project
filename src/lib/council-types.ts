/** What the server sends the browser about a council session. */
import type { DeskAsset, RequestBrief } from "./assets";
import type { DeskInfo } from "./chains";
import type { Emotion, Fill, Portfolio } from "./council";
import type { AssetKey, Session } from "./market";
import type { AgentId } from "./types";

/** model: written by the AI model. scripted: rule-based stand-in, used when a model can't be reached. */
export type Source = "model" | "scripted";

export interface TokenStats {
  token: AssetKey;
  price: number;
  change24h: number; // percent
  change1h: number; // percent
  change15m: number; // percent
  change4h: number; // percent
  rsi14: number; // on 5-minute candles
  /** Volume of the last 15 minutes against the average of the two hours before. Null when the source has no volume. */
  volRatio: number | null;
  /** Short moving average against the long one, on 5-minute candles. */
  trend: "up" | "down" | "flat";
  /** Average true range as a percent of price: how far the token typically moves in 5 minutes. */
  atrPct: number;
  /** Where the price sits in its 24-hour range, 0 (low) to 100 (high). */
  rangePos: number;
  /** For a Stock Token: its 1-hour change minus the stock market's, in percentage points. Null for anything else. */
  vsMarket1h: number | null;
  high1h: number;
  low1h: number;
  /** Set for a Stock Token: whether it can be traded now. It can't at the weekend. */
  session?: Session;
  /** Full name, for a token a funder asked for. */
  name?: string;
  /** Set for a token priced by its trading pool. */
  pool?: { liquidityUsd: number; volume24hUsd: number };
  /** For a pool token, when its pool reports them: the change over the last five minutes, and the purchases and sales in that time. */
  change5m?: number;
  buys5m?: number;
  sells5m?: number;
}

export interface Pitch {
  agent: AgentId;
  action: "BUY" | "SELL" | "HOLD";
  token: AssetKey;
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
  token: AssetKey;
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

/** A trade an agent made for its own book, without a vote. */
export interface OwnTrade {
  agent: AgentId;
  fill: Fill;
  /** The desk's books after the trade. */
  portfolio: Portfolio;
  note: string;
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
  /** `sold`: what the desk sold before the session began, because it no longer trades it. */
  | { stage: "open"; round: number; mode: CouncilMode; stats: TokenStats[]; portfolio: Portfolio; startedAt: number; request?: RequestBrief | null; sold?: OwnTrade[] }
  | { stage: "pitches"; pitches: Pitch[]; proposal: Proposal | null }
  | { stage: "debate"; exchanges: Exchange[] }
  /** `committed`: the leader was bound by a funder's request to trade whatever the vote. */
  | { stage: "decision"; pledges: Pledge[]; closing: Line; votes: Vote[]; approved: boolean; committed?: boolean }
  /** `own`: trades the agents then made for their own books, in the order they were made. */
  | { stage: "outcome"; fill: Fill | null; portfolio: Portfolio; note: string; own?: OwnTrade[] }
  | { stage: "error"; message: string };

export interface CouncilSnapshot {
  mode: CouncilMode;
  /** Why the council is not running on live models, when it isn't. */
  modeNote: string | null;
  models: Record<AgentId, ModelInfo>;
  round: number;
  portfolio: Portfolio;
  /** The contract that holds the agents' USDG and records their trades. Null if none is deployed. */
  desk: DeskInfo | null;
  /** The tokens the agents chose from in the latest session: the ones trending on Robinhood Chain then. */
  board: AssetKey[];
  /** Tokens funders asked for, with the last price seen for each. */
  assets: Record<AssetKey, DeskAsset>;
  fills: Fill[];
  nextRoundAt: number;
  intervalMs: number;
  serverTime: number;
}

export type RoundResponse = { wait: number; nextRoundAt: number };
