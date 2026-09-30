/**
 * What the documentation states as fact: where the contracts are and what the desk's numbers
 * are. They are read from the desk's own settings and rules, so the page follows them when a
 * contract is replaced or a term is changed.
 */
import { getAddress, isAddress } from "viem";
import { COMMITTED_HOLD_ROUNDS, COUNCIL_MAX_USD, MAX_POSITION_SHARE, MIN_ORDER_USD, OWN_BOOK_SHARE, SOLO_USD, START_CASH, TAKE_PROFIT_PCT } from "@/lib/council";
import { DEPLOYED, type Deployment } from "@/lib/deployments";
import type { FundingTerms } from "@/lib/funding";
import type { AgentId } from "@/lib/types";
import { connection } from "./chains/robinhood";
import { STOP_RANGE, TARGET_RANGE } from "./council/brain";
import { councilConfig } from "./council/config";
import { NERVE } from "./council/risk";
import { FUNDING_LEVELS } from "./council/skills";
import { fundConfig } from "./fund/config";
import { boardLimits, boardSource } from "./market/trending";
import { rewardsConfig } from "./rewards/config";

export interface DocsFacts {
  /** The contracts the site uses, on the network it runs on. */
  live: Deployment;
  /** The same contracts on the other network. */
  other: Deployment;
  testnet: boolean;
  sessionMinutes: number;
  terms: FundingTerms;
  rewardUsd: number;
  faucet: { on: boolean; amount: number };
  board: { size: number; minLiquidityUsd: number; minVolumeUsd: number; minAgeHours: number; ponsOnly: boolean };
  /** Users' funding from which an agent is given each level of analysis. */
  levels: Array<{ from: number; label: string }>;
  /** How far a token must fall before each agent sells what it holds of it, in percent. */
  nerve: Record<AgentId, { m5: number; h1: number }>;
  rules: {
    startCash: number;
    minOrderUsd: number;
    ownBookPct: number;
    maxPositionPct: number;
    committedHold: number;
    /** What an agent puts into a purchase of its own, in USDG: the least and the most. */
    soloUsd: readonly [number, number];
    /** The most the agents put into a purchase together, in all. */
    councilMaxUsd: number;
    /** The gain, in percent, at which a position is sold. */
    takeProfitPct: number;
    stop: readonly [number, number];
    target: readonly [number, number];
  };
}

const asAddress = (raw: string | undefined) => (raw && isAddress(raw, { strict: false }) ? getAddress(raw) : null);

export function docsFacts(): DocsFacts {
  const env = process.env;
  const c = connection();
  const known = DEPLOYED[c.network];
  const live: Deployment = {
    ...known,
    desks: c.desks ?? known.desks,
    shares: asAddress(env.DESK_SHARES) ?? known.shares,
    treasury: c.account?.address ?? known.treasury,
    usdg: c.token ?? known.usdg,
    usdgSymbol: env.TOKEN_SYMBOL || known.usdgSymbol,
  };
  const limits = boardLimits();

  return {
    live,
    other: DEPLOYED[c.testnet ? "mainnet" : "testnet"],
    testnet: c.testnet,
    sessionMinutes: Math.round(councilConfig().intervalMs / 60_000),
    terms: fundConfig().terms,
    rewardUsd: rewardsConfig().amount,
    faucet: { on: c.testnet && env.FAUCET_ENABLED === "true", amount: Number(env.FAUCET_AMOUNT) > 0 ? Number(env.FAUCET_AMOUNT) : 100 },
    board: { ...limits, ponsOnly: boardSource() === "pons" },
    levels: FUNDING_LEVELS.map(({ from, label }) => ({ from, label })),
    nerve: NERVE,
    rules: {
      startCash: START_CASH,
      minOrderUsd: MIN_ORDER_USD,
      ownBookPct: OWN_BOOK_SHARE * 100,
      maxPositionPct: MAX_POSITION_SHARE * 100,
      committedHold: COMMITTED_HOLD_ROUNDS,
      soloUsd: SOLO_USD,
      councilMaxUsd: COUNCIL_MAX_USD,
      takeProfitPct: TAKE_PROFIT_PCT,
      stop: STOP_RANGE,
      target: TARGET_RANGE,
    },
  };
}
