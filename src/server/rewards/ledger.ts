/**
 * Claim ledger. One JSON file on disk, which is fine for a single server.
 * Replace with Postgres before running more than one instance or deploying serverless,
 * where local files don't persist.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "@/lib/types";

export interface Claim {
  wallet: string;
  agent: AgentId;
  amount: number;
  ip: string;
  ts: number;
  /** pending: reserved or sent but not yet confirmed. sent: confirmed on-chain. */
  status: "pending" | "sent";
  signature: string | null;
  lastValidBlockHeight: number | null;
}

interface Ledger {
  claims: Record<string, Claim>;
}

const FILE = path.join(process.cwd(), ".data", "claims.json");

async function load(): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Ledger;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { claims: {} };
    throw e;
  }
}

async function save(ledger: Ledger) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(ledger, null, 2));
  await rename(tmp, FILE);
}

// All reads and writes go through one queue so two requests can't both reserve the same claim.
let queue: Promise<unknown> = Promise.resolve();
function locked<T>(fn: (ledger: Ledger) => Promise<T> | T): Promise<T> {
  const run = queue.then(async () => fn(await load()));
  queue = run.catch(() => {});
  return run;
}

const dayStart = () => new Date().setUTCHours(0, 0, 0, 0);

export const getClaim = (wallet: string) => locked((l) => l.claims[wallet] ?? null);

export const claimsToday = () => locked((l) => Object.values(l.claims).filter((c) => c.ts >= dayStart()).length);

export type ReserveResult = { ok: true } | { ok: false; reason: "claimed" | "daily_cap" | "ip_limit"; claim?: Claim };

/** Atomically checks every limit and reserves the claim for this wallet. */
export function reserveClaim(
  input: Pick<Claim, "wallet" | "agent" | "amount" | "ip">,
  limits: { dailyCap: number; ipDailyLimit: number },
): Promise<ReserveResult> {
  return locked(async (l) => {
    const existing = l.claims[input.wallet];
    if (existing) return { ok: false, reason: "claimed", claim: existing };
    const today = Object.values(l.claims).filter((c) => c.ts >= dayStart());
    if (today.length >= limits.dailyCap) return { ok: false, reason: "daily_cap" };
    if (today.filter((c) => c.ip === input.ip).length >= limits.ipDailyLimit) return { ok: false, reason: "ip_limit" };
    l.claims[input.wallet] = { ...input, ts: Date.now(), status: "pending", signature: null, lastValidBlockHeight: null };
    await save(l);
    return { ok: true };
  });
}

export function updateClaim(wallet: string, patch: Partial<Claim>) {
  return locked(async (l) => {
    if (!l.claims[wallet]) return null;
    l.claims[wallet] = { ...l.claims[wallet], ...patch };
    await save(l);
    return l.claims[wallet];
  });
}

/** Frees the wallet to try again. Only call when the payment definitely did not land. */
export function releaseClaim(wallet: string) {
  return locked(async (l) => {
    delete l.claims[wallet];
    await save(l);
  });
}
