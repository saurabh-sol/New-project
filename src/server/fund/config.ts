import { DEFAULT_TERMS, type FundingTerms } from "@/lib/funding";
import { hasDb } from "../db";
import { rewardsConfig, type RewardsConfig } from "../rewards/config";

export interface FundConfig {
  chain: RewardsConfig;
  enabled: boolean;
  reason: string | null;
  terms: FundingTerms;
  tokenSymbol: string;
  faucet: boolean;
  faucetAmount: number;
  /** Most bonus money promised per UTC day. Bounds what bonus farming can cost. */
  bonusDailyBudget: number;
}

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

export function fundConfig(): FundConfig {
  const env = process.env;
  const chain = rewardsConfig();
  const devnet = chain.cluster === "devnet";

  // Taking real deposits is a custody business with legal duties. It stays off on mainnet unless switched on deliberately.
  const reason = !hasDb()
    ? "Funding needs a database. Set DATABASE_URL."
    : chain.treasuryError
      ? chain.treasuryError
      : !chain.treasury
        ? "Funding needs a treasury wallet. Set TREASURY_SECRET_KEY."
        : !devnet && env.ALLOW_MAINNET_FUNDING !== "true"
          ? "Funding is switched off on mainnet."
          : null;

  return {
    chain,
    enabled: reason === null,
    reason,
    terms: {
      ...DEFAULT_TERMS,
      minDeposit: num(env.FUND_MIN_DEPOSIT, DEFAULT_TERMS.minDeposit),
      maxDeposit: num(env.FUND_MAX_DEPOSIT, DEFAULT_TERMS.maxDeposit),
      feeMin: num(env.WITHDRAW_FEE_MIN_USD, DEFAULT_TERMS.feeMin),
      feePct: num(env.WITHDRAW_FEE_PCT, DEFAULT_TERMS.feePct),
      bonusLockHours: num(env.BONUS_LOCK_HOURS, DEFAULT_TERMS.bonusLockHours),
    },
    tokenSymbol: env.TOKEN_SYMBOL || (devnet ? "test USDC" : "USDC"),
    faucet: devnet && env.FAUCET_ENABLED === "true",
    faucetAmount: num(env.FAUCET_AMOUNT, 100),
    bonusDailyBudget: num(env.BONUS_DAILY_BUDGET_USD, 50),
  };
}
