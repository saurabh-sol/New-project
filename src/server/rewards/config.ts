export interface RewardsConfig {
  amount: number; // USDG per claim
  dailyCap: number; // claims per UTC day
  ipDailyLimit: number;
  /** Past transactions a wallet needs. Null means the default: none on the testnet, five on mainnet. */
  minWalletTxs: number | null;
  turnstileSecret: string | null;
  turnstileSiteKey: string | null;
}

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

export function rewardsConfig(): RewardsConfig {
  const env = process.env;
  return {
    amount: num(env.REWARD_USDG ?? env.REWARD_USDG, 1.5),
    dailyCap: num(env.DAILY_CLAIM_CAP, 100),
    ipDailyLimit: num(env.IP_DAILY_LIMIT, 3),
    minWalletTxs: env.MIN_WALLET_TXS ? num(env.MIN_WALLET_TXS, 0) : null,
    turnstileSecret: env.TURNSTILE_SECRET_KEY || null,
    turnstileSiteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null,
  };
}

/** Past transactions a wallet needs before it can claim, on a network of the given kind. */
export const minHistory = (cfg: RewardsConfig, testnet: boolean) => cfg.minWalletTxs ?? (testnet ? 0 : 5);
