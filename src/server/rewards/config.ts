import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export type Cluster = "devnet" | "mainnet-beta";

const USDC_MINT: Record<Cluster, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

const RPC: Record<Cluster, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

export const USDC_DECIMALS = 6;

export interface RewardsConfig {
  cluster: Cluster;
  rpcUrl: string;
  mint: PublicKey;
  /** Null means no treasury is configured and the app runs in demo mode. */
  treasury: Keypair | null;
  /** Set when TREASURY_SECRET_KEY is present but can't be parsed. */
  treasuryError: string | null;
  amount: number; // USDC per claim
  dailyCap: number; // claims per UTC day
  ipDailyLimit: number;
  /** Past transactions a wallet needs. Null means the default: none on a testnet, five on a mainnet. */
  minWalletTxs: number | null;
  turnstileSecret: string | null;
  turnstileSiteKey: string | null;
}

const num = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return raw !== undefined && raw !== "" && isFinite(n) && n >= 0 ? n : fallback;
};

/** Accepts a solana-keygen JSON array or a base58 secret key (Phantom export). */
function parseKeypair(raw: string): Keypair {
  const text = raw.trim();
  const bytes = text.startsWith("[") ? Uint8Array.from(JSON.parse(text) as number[]) : bs58.decode(text);
  return Keypair.fromSecretKey(bytes);
}

export function rewardsConfig(): RewardsConfig {
  const env = process.env;
  const cluster: Cluster = env.SOLANA_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet";

  let treasury: Keypair | null = null;
  let treasuryError: string | null = null;
  if (env.TREASURY_SECRET_KEY) {
    try {
      treasury = parseKeypair(env.TREASURY_SECRET_KEY);
    } catch {
      treasuryError = "TREASURY_SECRET_KEY is set but is not a valid Solana secret key.";
    }
  }

  return {
    cluster,
    rpcUrl: env.SOLANA_RPC_URL || RPC[cluster],
    mint: new PublicKey(env.USDC_MINT || USDC_MINT[cluster]),
    treasury,
    treasuryError,
    amount: num(env.REWARD_USDC, 1.5),
    dailyCap: num(env.DAILY_CLAIM_CAP, 100),
    ipDailyLimit: num(env.IP_DAILY_LIMIT, 3),
    minWalletTxs: env.MIN_WALLET_TXS ? num(env.MIN_WALLET_TXS, 0) : null,
    turnstileSecret: env.TURNSTILE_SECRET_KEY || null,
    turnstileSiteKey: env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null,
  };
}


/** Past transactions a wallet needs before it can claim, on a chain of the given kind. */
export const minHistory = (cfg: RewardsConfig, testnet: boolean) => cfg.minWalletTxs ?? (testnet ? 0 : 5);
