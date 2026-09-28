import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { USDC_DECIMALS, type RewardsConfig } from "./config";
import { releaseClaim, updateClaim, type Claim } from "./ledger";

export const connect = (cfg: RewardsConfig) => new Connection(cfg.rpcUrl, "confirmed");

const toUnits = (usdc: number) => BigInt(Math.round(usdc * 10 ** USDC_DECIMALS));

/** USDC the treasury can still pay out, or 0 if it has no USDC account yet. */
export async function treasuryBalance(conn: Connection, cfg: RewardsConfig, treasury: Keypair): Promise<number> {
  try {
    const account = getAssociatedTokenAddressSync(cfg.mint, treasury.publicKey);
    return (await conn.getTokenAccountBalance(account)).value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

export async function hasEnoughHistory(conn: Connection, wallet: PublicKey, min: number): Promise<boolean> {
  if (min <= 0) return true;
  return (await conn.getSignaturesForAddress(wallet, { limit: min })).length >= min;
}

/**
 * Sends the reward from the treasury, which also pays the network fee and, if the
 * user has never held USDC, the rent for their token account.
 *
 * The signature is written to the ledger before the transaction is broadcast, so a
 * crash or timeout can never lead to paying the same wallet twice.
 */
export async function payReward(conn: Connection, cfg: RewardsConfig, treasury: Keypair, to: PublicKey, amount: number) {
  const from = getAssociatedTokenAddressSync(cfg.mint, treasury.publicKey);
  const dest = getAssociatedTokenAddressSync(cfg.mint, to);
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");

  const tx = new Transaction({ feePayer: treasury.publicKey, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, dest, to, cfg.mint),
    createTransferCheckedInstruction(from, cfg.mint, dest, treasury.publicKey, toUnits(amount), USDC_DECIMALS),
  );
  tx.sign(treasury);
  const signature = bs58.encode(tx.signature!);

  await updateClaim(to.toBase58(), { signature, lastValidBlockHeight });
  await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const result = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  if (result.value.err) throw new Error(`Transfer failed on-chain: ${JSON.stringify(result.value.err)}`);
  return signature;
}

/**
 * Resolves a claim left pending by a timeout or crash: marks it sent if the transfer
 * landed, frees the wallet if it provably never will, and otherwise leaves it pending.
 */
export async function settlePending(conn: Connection, claim: Claim): Promise<Claim | null> {
  if (claim.status !== "pending") return claim;
  if (!claim.signature || claim.lastValidBlockHeight === null) {
    // Reserved but never signed. Give an in-flight request a minute before freeing it.
    if (Date.now() - claim.ts < 60_000) return claim;
    await releaseClaim(claim.wallet);
    return null;
  }
  const status = (await conn.getSignatureStatus(claim.signature, { searchTransactionHistory: true })).value;
  if (status?.err) {
    await releaseClaim(claim.wallet);
    return null;
  }
  if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
    return updateClaim(claim.wallet, { status: "sent" });
  }
  if (!status && (await conn.getBlockHeight("confirmed")) > claim.lastValidBlockHeight) {
    await releaseClaim(claim.wallet);
    return null;
  }
  return claim;
}
