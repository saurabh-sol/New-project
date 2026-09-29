import type { ChainId, ChainStatus, DepositProof, PreparedDeposit } from "@/lib/chains";

export type Fate = "landed" | "dead" | "unknown";

/** A payment from the treasury that has been signed but not sent. */
export interface SignedPayment {
  /** Transaction hash. Known before sending, so it can be recorded first. */
  id: string;
  /** The payment's place in the treasury's queue of transactions (its nonce). Once another transaction has taken that place, this one can never land. */
  expiry: number;
  /** Sends it and waits for confirmation. Throws if the network rejects it or it fails. */
  send(): Promise<void>;
}

export interface DepositIntent {
  wallet: string;
  usd: number;
  /** Whatever `prepareDeposit` returned as `check`. */
  check: string;
  createdAt: number;
}

/**
 * Everything the app needs from the blockchain. Funding and rewards are written
 * against this, so none of them talks to the network directly.
 */
export interface Chain {
  readonly id: ChainId;
  status(): Promise<ChainStatus>;

  /** The address in its standard form, or null if it isn't a wallet address on this chain. */
  normalize(address: unknown): string | null;
  /** Whether `signature` is this wallet's signature of `message`. */
  verify(address: string, message: string, signature: string): Promise<boolean>;
  /** Whether the wallet has made at least `min` transactions. */
  hasHistory(address: string, min: number): Promise<boolean>;

  balance(address: string): Promise<number>;
  treasuryBalance(): Promise<number>;

  /**
   * Runs `work` while holding the treasury. Payments are signed and sent one at a
   * time, so two of them can never claim the same place in the queue.
   */
  withTreasury<T>(work: () => Promise<T>): Promise<T>;
  signPayment(to: string, usd: number): Promise<SignedPayment>;
  signFaucet(to: string, usd: number): Promise<SignedPayment>;
  fate(id: string, expiry: number, ageMs: number): Promise<Fate>;

  prepareDeposit(wallet: string, usd: number): Promise<{ payload: PreparedDeposit; check: string }>;
  /** Verifies the deposit really happened as prepared, waiting for it to confirm. Returns its id. */
  settleDeposit(intent: DepositIntent, proof: DepositProof): Promise<{ ok: true; id: string } | { ok: false; error: string }>;
}
