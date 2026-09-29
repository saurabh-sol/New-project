import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AGENTS } from "@/lib/agents";
import type { AgentId } from "@/lib/types";

const TTL_MS = 5 * 60 * 1000;

// Without CLAIM_SECRET, challenges only survive as long as this server process.
const SECRET = process.env.CLAIM_SECRET || randomBytes(32).toString("hex");

const mac = (message: string) => createHmac("sha256", SECRET).update(message).digest("base64url");

export const isAgentId = (v: unknown): v is AgentId => typeof v === "string" && v in AGENTS;

/** The human-readable text the wallet shows the user, plus a token proving we issued it. */
export function issueChallenge(wallet: string, agent: AgentId, amount: number) {
  const message = [
    "The Council: Arena Rewards",
    "",
    `Sign to prove you own this wallet and claim ${amount} USDG.`,
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

/**
 * A server-issued message for the wallet to sign, for any action. `fields` are shown
 * to the user and checked again when the signed message comes back.
 */
export function issueMessage(title: string, summary: string, fields: Record<string, string>) {
  const message = [
    `The Council: ${title}`,
    "",
    summary,
    "Signing is free and does not send a transaction.",
    "",
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    `Nonce: ${randomBytes(12).toString("hex")}`,
    `Issued: ${new Date().toISOString()}`,
  ].join("\n");
  return { message, token: mac(message) };
}

/** Checks that we issued this exact message, that it is fresh, and that it carries the expected fields. */
export function checkMessage(message: string, token: string, title: string, fields: Record<string, string>): string | null {
  const expected = Buffer.from(mac(message));
  const given = Buffer.from(token);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "This request is not valid. Start again.";
  if (!message.startsWith(`The Council: ${title}\n`)) return "This request was issued for a different action.";
  for (const [k, v] of Object.entries(fields)) if (field(message, k) !== v) return `This request was issued for a different ${k.toLowerCase()}.`;
  const issued = Date.parse(field(message, "Issued") ?? "");
  if (!isFinite(issued) || Date.now() - issued > TTL_MS) return "This request expired. Start again.";
  return null;
}
