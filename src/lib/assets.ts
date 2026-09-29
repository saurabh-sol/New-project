/** Tokens on Robinhood Chain that a funder asked an agent to trade. Shared by server and browser. */
import type { AssetKey, Session } from "./market";
import type { AgentId } from "./types";

export interface Asset {
  /** Name used for this token everywhere in the app. Usually its symbol. */
  key: AssetKey;
  symbol: string;
  name: string;
  /** The token's contract address on Robinhood Chain. */
  address: string;
  /**
   * stock: a Robinhood Stock Token, priced by Robinhood.
   * pool: any other token, priced by its most liquid trading pool.
   */
  kind: "stock" | "pool";
  /** For a pool token: the pool its price and candles come from. */
  pool?: string;
}

export interface AssetQuote {
  price: number;
  change24h: number; // percent
  /** What the token's pool holds. Null for a Stock Token, which is not priced by a pool. */
  liquidityUsd: number | null;
  volume24hUsd: number;
  /** Set for Stock Tokens. */
  session?: Session;
}

/** A token the desk has been asked to trade, with the last price seen for it. */
export interface DeskAsset extends Asset {
  quote: AssetQuote;
  quotedAt: number;
}

/**
 * How strongly an agent is bound by a funder's request.
 * suggest: the agent presents it once and the council votes.
 * commit: the agent takes the trade with its own cash, and the others choose whether to join.
 */
export type RequestMode = "suggest" | "commit";

export const requestMode = (usd: number, commitFrom: number): RequestMode => (usd >= commitFrom ? "commit" : "suggest");

/** The request a session is hearing, as the browser and the agents see it. */
export interface RequestBrief {
  agent: AgentId;
  asset: Asset;
  mode: RequestMode;
  /** The funding that came with the request. */
  usd: number;
  liquidityUsd: number | null;
  volume24hUsd: number;
}

export type RequestStatus = "pending" | "presenting" | "executed" | "rejected" | "failed";

export interface TradeRequest {
  id: number;
  agent: AgentId;
  asset: Asset;
  mode: RequestMode;
  usd: number;
  status: RequestStatus;
  /** Session in which it was presented, once it has been. */
  round: number | null;
  /** What happened, in a sentence. */
  note: string | null;
  ts: number;
}

export type AssetPreview = { ok: true; asset: Asset; quote: AssetQuote } | { ok: false; error: string };
