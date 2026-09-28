import { PublicKey } from "@solana/web3.js";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { AGENTS } from "@/lib/agents";
import type { AgentId } from "@/lib/types";

const TTL_MS = 5 * 60 * 1000;

// Without CLAIM_SECRET, challenges only survive as long as this server process.
const SECRET = process.env.CLAIM_SECRET || randomBytes(32).toString("hex");

const mac = (message: string) => createHmac("sha256", SECRET).update(message).digest("base64url");

export const isAgentId = (v: unknown): v is AgentId => typeof v === "string" && v in AGENTS;

/** Returns the wallet's public key, or null if the address isn't a normal wallet address. */
export function parseWallet(address: unknown): PublicKey | null {
  if (typeof address !== "string" || address.length < 32 || address.length > 44) return null;
  try {
    const key = new PublicKey(address);
    return PublicKey.isOnCurve(key.toBytes()) ? key : null;
  } catch {
    return null;
  }
}

/** The human-readable text the wallet shows the user, plus a token proving we issued it. */
export function issueChallenge(wallet: string, agent: AgentId, amount: number) {
  const message = [
    "The Council: Arena Rewards",
    "",
    `Sign to prove you own this wallet and claim ${amount} USDC.`,
    "Signing is free and does not send a transaction.",
    "",
    `Wallet: ${wallet}`,
    `Backing: ${AGENTS[agent].name}`,
    `Nonce: ${randomBytes(12).toString("hex")}`,
    `Issued: ${new Date().toISOString()}`,
  ].join("\n");
  return { message, token: mac(message) };
}

const field = (message: string, name: string) => message.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];

/** Checks that we issued this exact message for this wallet and agent, and that it is still fresh. */
export function checkChallenge(message: string, token: string, wallet: string, agent: AgentId): string | null {
  const expected = Buffer.from(mac(message));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "This sign-in request is not valid. Start again.";
  if (field(message, "Wallet") !== wallet) return "This sign-in request was issued for a different wallet.";
  if (field(message, "Backing") !== AGENTS[agent].name) return "This sign-in request was issued for a different agent.";
  const issued = Date.parse(field(message, "Issued") ?? "");
  if (!isFinite(issued) || Date.now() - issued > TTL_MS) return "This sign-in request expired. Start again.";
  return null;
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Verifies an ed25519 signature made by the wallet over the message. */
export function verifySignature(wallet: PublicKey, message: string, signatureBase64: string): boolean {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    if (signature.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, wallet.toBytes()]), format: "der", type: "spki" });
    return verify(null, Buffer.from(message, "utf8"), key, signature);
  } catch {
    return false;
  }
}
