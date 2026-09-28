/**
 * Claim ledger. Kept in Postgres when DATABASE_URL is set. Without a database it
 * falls back to one JSON file on disk, which only suits a single server.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentId } from "@/lib/types";
import { db, hasDb, num } from "../db";

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

const fileGetClaim = (wallet: string) => locked((l) => l.claims[wallet] ?? null);

const fileClaimsToday = () => locked((l) => Object.values(l.claims).filter((c) => c.ts >= dayStart()).length);

export type ReserveResult = { ok: true } | { ok: false; reason: "claimed" | "daily_cap" | "ip_limit"; claim?: Claim };

/** Atomically checks every limit and reserves the claim for this wallet. */
function fileReserveClaim(
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

function fileUpdateClaim(wallet: string, patch: Partial<Claim>) {
  return locked(async (l) => {
    if (!l.claims[wallet]) return null;
    l.claims[wallet] = { ...l.claims[wallet], ...patch };
    await save(l);
    return l.claims[wallet];
  });
}

/** Frees the wallet to try again. Only call when the payment definitely did not land. */
function fileReleaseClaim(wallet: string) {
  return locked(async (l) => {
    delete l.claims[wallet];
    await save(l);
  });
}

// --- Postgres ---

type Row = Record<string, unknown>;

const toClaim = (r: Row): Claim => ({
  wallet: r.wallet as string,
  agent: r.agent as AgentId,
  amount: num(r.amount),
  ip: r.ip as string,
  ts: new Date(r.created_at as string).getTime(),
  status: r.status as Claim["status"],
  signature: (r.signature as string | null) ?? null,
  lastValidBlockHeight: r.last_valid_block_height === null ? null : num(r.last_valid_block_height),
});

async function dbGetClaim(wallet: string): Promise<Claim | null> {
  const sql = await db();
  const [row] = await sql`select * from reward_claims where wallet = ${wallet}`;
  return row ? toClaim(row) : null;
}

async function dbClaimsToday(): Promise<number> {
  const sql = await db();
  const [row] = await sql`select count(*)::int as n from reward_claims where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'`;
  return num(row.n);
}

/** One statement checks every limit and inserts, so two requests can't both get through. */
async function dbReserveClaim(input: Pick<Claim, "wallet" | "agent" | "amount" | "ip">, limits: { dailyCap: number; ipDailyLimit: number }): Promise<ReserveResult> {
  const sql = await db();
  const inserted = await sql`
    with today as (
      select ip from reward_claims where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
    )
    insert into reward_claims (wallet, agent, amount, ip, status)
    select ${input.wallet}, ${input.agent}, ${input.amount}, ${input.ip}, 'pending'
    where (select count(*) from today) < ${limits.dailyCap}
      and (select count(*) from today where ip = ${input.ip}) < ${limits.ipDailyLimit}
    on conflict (wallet) do nothing
    returning wallet`;
  if (inserted.length === 1) return { ok: true };

  const existing = await dbGetClaim(input.wallet);
  if (existing) return { ok: false, reason: "claimed", claim: existing };
  return { ok: false, reason: (await dbClaimsToday()) >= limits.dailyCap ? "daily_cap" : "ip_limit" };
}

async function dbUpdateClaim(wallet: string, patch: Partial<Claim>): Promise<Claim | null> {
  const sql = await db();
  const [row] = await sql`
    update reward_claims set
      status = coalesce(${patch.status ?? null}, status),
      signature = coalesce(${patch.signature ?? null}, signature),
      last_valid_block_height = coalesce(${patch.lastValidBlockHeight ?? null}, last_valid_block_height)
    where wallet = ${wallet}
    returning *`;
  return row ? toClaim(row) : null;
}

async function dbReleaseClaim(wallet: string): Promise<void> {
  const sql = await db();
  await sql`delete from reward_claims where wallet = ${wallet}`;
}

// --- public API ---

export const getClaim = (wallet: string) => (hasDb() ? dbGetClaim(wallet) : fileGetClaim(wallet));
export const claimsToday = () => (hasDb() ? dbClaimsToday() : fileClaimsToday());
export const reserveClaim = (input: Pick<Claim, "wallet" | "agent" | "amount" | "ip">, limits: { dailyCap: number; ipDailyLimit: number }) =>
  hasDb() ? dbReserveClaim(input, limits) : fileReserveClaim(input, limits);
export const updateClaim = (wallet: string, patch: Partial<Claim>) => (hasDb() ? dbUpdateClaim(wallet, patch) : fileUpdateClaim(wallet, patch));
export const releaseClaim = (wallet: string) => (hasDb() ? dbReleaseClaim(wallet) : fileReleaseClaim(wallet));
