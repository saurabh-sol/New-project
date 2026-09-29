import type { ChainStatus } from "./chains";
import type { AgentId } from "./types";

export interface ClaimRecord {
  status: "pending" | "sent";
  signature: string | null;
  amount: number;
  agent: AgentId;
  ts: number;
}

export interface RewardsStatus {
  /** demo: no treasury is configured, so nothing is ever sent. */
  mode: "live" | "demo";
  /** The network the reward is paid on. */
  chain: ChainStatus;
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
  | { ok: true; mode: "live"; claim: ClaimRecord }
  | { ok: false; error: string; claim?: ClaimRecord };
