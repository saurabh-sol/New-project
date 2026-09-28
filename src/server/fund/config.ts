import { DEFAULT_TERMS, type FundingTerms } from "@/lib/funding";

export interface FundConfig {
  terms: FundingTerms;
  /** Most bonus money promised per UTC day. Bounds what bonus farming can cost. */
  bonusDailyBudget: number;
}

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

/** The terms of funding, which are the same on every chain. */
export function fundConfig(): FundConfig {
  const env = process.env;
  return {
    terms: {
      ...DEFAULT_TERMS,
      minDeposit: num(env.FUND_MIN_DEPOSIT, DEFAULT_TERMS.minDeposit),
      maxDeposit: num(env.FUND_MAX_DEPOSIT, DEFAULT_TERMS.maxDeposit),
      feeMin: num(env.WITHDRAW_FEE_MIN_USD, DEFAULT_TERMS.feeMin),
      feePct: num(env.WITHDRAW_FEE_PCT, DEFAULT_TERMS.feePct),
      bonusLockHours: num(env.BONUS_LOCK_HOURS, DEFAULT_TERMS.bonusLockHours),
    },
    bonusDailyBudget: num(env.BONUS_DAILY_BUDGET_USD, 50),
  };
}
