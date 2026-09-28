import type { AgentId } from "./types";

export type RewardsCluster = "devnet" | "mainnet-beta";

export interface ClaimRecord {
  status: "pending" | "sent";
  signature: string | null;
  amount: number;
  agent: AgentId;
  ts: number;
}

export interface RewardsStatus {
  /** demo: no treasury configured, nothing is ever sent. */
  mode: "live" | "demo";
  cluster: RewardsCluster;
  amount: number;
  remainingToday: number;
  captchaSiteKey: string | null;
  /** Set when rewards can't be paid right now (misconfigured, pool empty). */
  problem: string | null;
  claim: ClaimRecord | null;
}

export interface ChallengeResponse {
  message: string;
  token: string;
}

export type ClaimResponse =
  | { ok: true; mode: "demo"; amount: number }
  | { ok: true; mode: "live"; cluster: RewardsCluster; claim: ClaimRecord }
  | { ok: false; error: string; claim?: ClaimRecord };
