import type { FundingTerms } from "./funding";
import type { AgentId } from "./types";

export interface AgentFunding {
  agent: AgentId;
  /** Value of one share. Starts at 1. */
  nav: number;
  returnPct: number;
  /** What users have put into this agent, net of withdrawals. */
  fundedUsd: number;
  /** Cash not tied up in open positions, which is what can be withdrawn right now. */
  freeCash: number;
  level: number;
  levelLabel: string;
  /** Funding at which the next analysis level starts, or null at the top level. */
  nextLevelAt: number | null;
}

export interface FundPosition {
  agent: AgentId;
  shares: number;
  principal: number;
  value: number;
  pnl: number;
}

export interface FundBonus {
  usd: number;
  depositUsd: number;
  agent: AgentId;
  unlockAt: number;
  status: "locked" | "paying" | "paid" | "forfeited";
  signature: string | null;
}

export interface FundEvent {
  id: number;
  kind: "deposit" | "withdraw" | "faucet";
  agent: AgentId | null;
  usd: number;
  fee: number;
  status: "pending" | "done" | "failed";
  signature: string | null;
  ts: number;
}

export interface FundStatus {
  enabled: boolean;
  /** Why funding is off, when it is. */
  reason: string | null;
  cluster: "devnet" | "mainnet-beta";
  tokenSymbol: string;
  /** Whether this server hands out free test tokens. Devnet only. */
  faucet: boolean;
  faucetAmount: number;
  terms: FundingTerms;
  agents: AgentFunding[];
  wallet: null | {
    balance: number;
    positions: FundPosition[];
    bonus: FundBonus | null;
    /** True while this wallet can still earn its one first-deposit bonus. */
    bonusAvailable: boolean;
    events: FundEvent[];
  };
}

export type FundResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };
