import type { Chain } from "../chains";
import { releaseClaim, updateClaim, type Claim } from "./ledger";

/**
 * Sends a reward. The payment's id is written to the ledger before it is sent,
 * so a crash or timeout can never lead to paying the same wallet twice.
 */
export function payReward(chain: Chain, address: string, amount: number): Promise<string> {
  return chain.withTreasury(async () => {
    const signed = await chain.signPayment(address, amount);
    await updateClaim(address, { signature: signed.id, lastValidBlockHeight: signed.expiry });
    await signed.send();
    return signed.id;
  });
}

/**
 * Resolves a claim left pending by a timeout or crash: marks it sent if the payment
 * landed, frees the wallet if it provably never will, and otherwise leaves it pending.
 */
export async function settlePending(chain: Chain, claim: Claim): Promise<Claim | null> {
  if (claim.status !== "pending") return claim;
  const ageMs = Date.now() - claim.ts;
  if (!claim.signature || claim.lastValidBlockHeight === null) {
    // Reserved but never signed. Give an in-flight request a minute before freeing it.
    if (ageMs < 60_000) return claim;
    await releaseClaim(claim.wallet);
    return null;
  }
  const outcome = await chain.fate(claim.signature, claim.lastValidBlockHeight, ageMs);
  if (outcome === "landed") return updateClaim(claim.wallet, { status: "sent" });
  if (outcome === "dead") {
    await releaseClaim(claim.wallet);
    return null;
  }
  return claim;
}
