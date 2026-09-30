/**
 * What the documentation states as fact: where the contracts are and what the desk's numbers
 * are. They are read from the desk's own settings and rules, so the page follows them when a
 * contract is replaced or a term is changed.
 */
import { getAddress, isAddress } from "viem";
import { COMMITTED_HOLD_ROUNDS, COUNCIL_MAX_USD, EXITS, MAX_POSITION_SHARE, MIN_ORDER_USD, OWN_BOOK_SHARE, SOLO_USD, START_CASH } from "@/lib/council";
import { DEPLOYED, type Deployment } from "@/lib/deployments";
import type { FundingTerms } from "@/lib/funding";
import type { AgentId } from "@/lib/types";
import { AGENT_ORDER } from "@/lib/agents";
import { connection } from "./chains/robinhood";
import { maxCostPct, realTrading } from "./chains/wallets";
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
  /** Each agent's wallet, when the desk trades on the market: its trades are then swaps in the tokens' pools. Null when it does not. */
  wallets: Record<AgentId, string> | null;
  /** The most a swap may cost against the pool's price, in percent, each way. */
  maxCostPct: number;
  sessionMinutes: number;
  terms: FundingTerms;
  /** Whether people can fund an agent. On mainnet that is off unless the desk's owner has switched it on. */
  fundingOn: boolean;
  rewardUsd: number;
  /** Whether rewards are being paid. */
  rewardsOn: boolean;
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
    /** What a position must have made or lost, in USDG, for the desk to sell it, or to call a vote on selling it. */
    exits: { solo: { gain: number; loss: number }; council: { call: number; gain: number; loss: number } };
    stop: readonly [number, number];
    target: readonly [number, number];
  };
}

const asAddress = (raw: string | undefined) => (raw && isAddress(raw, { strict: false }) ? getAddress(raw) : null);

export function docsFacts(): DocsFacts {
  const env = process.env;
  const c = connection();
  // The page describes Robinhood Chain mainnet only, whatever network the server runs on. The server's own
  // settings come over the deployed addresses only when it runs there.
  const known = DEPLOYED.mainnet;
  const live: Deployment =
    c.network === "mainnet"
      ? {
          ...known,
          desks: c.desks ?? known.desks,
          shares: asAddress(env.DESK_SHARES) ?? known.shares,
          treasury: c.account?.address ?? known.treasury,
          usdg: c.token ?? known.usdg,
          usdgSymbol: env.TOKEN_SYMBOL || known.usdgSymbol,
        }
      : known;
  const limits = boardLimits();
  const rewards = rewardsConfig();

  return {
    live,
    other: DEPLOYED.testnet,
    testnet: false,
    wallets: realTrading() ? (Object.fromEntries(AGENT_ORDER.map((a) => [a, getAddress(env[`WALLET_${a.toUpperCase()}`]!)])) as Record<AgentId, string>) : null,
    maxCostPct: maxCostPct(),
    sessionMinutes: Math.round(councilConfig().intervalMs / 60_000),
    terms: fundConfig().terms,
    fundingOn: env.ALLOW_MAINNET_FUNDING === "true",
    rewardUsd: rewards.amount,
    rewardsOn: rewards.dailyCap > 0,
    faucet: { on: false, amount: Number(env.FAUCET_AMOUNT) > 0 ? Number(env.FAUCET_AMOUNT) : 100 },
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
      exits: EXITS,
      stop: STOP_RANGE,
      target: TARGET_RANGE,
    },
  };
}
