/**
 * Postgres (Neon). Server-side only: DATABASE_URL must never reach client code.
 * Tables are created on first use, so a fresh database needs no setup step.
 */
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

type Sql = NeonQueryFunction<false, false>;

const shared = globalThis as typeof globalThis & { __db?: { sql: Sql; ready: Promise<void> } };

export const hasDb = () => !!process.env.DATABASE_URL;

async function migrate(sql: Sql) {
  await sql`
    create table if not exists council_state (
      id int primary key,
      version bigint not null default 0,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists council_rounds (
      round int primary key,
      stages jsonb not null,
      failed boolean not null default false,
      created_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists agent_lines (
      id bigserial primary key,
      round int not null,
      agent text not null,
      kind text not null,
      say text not null,
      created_at timestamptz not null default now()
    )`;
  await sql`create index if not exists agent_lines_recent on agent_lines (agent, id desc)`;
  await sql`
    create table if not exists reward_claims (
      wallet text primary key,
      agent text not null,
      amount numeric not null,
      ip text not null,
      status text not null,
      signature text,
      last_valid_block_height bigint,
      created_at timestamptz not null default now()
    )`;
  await sql`create index if not exists reward_claims_day on reward_claims (created_at)`;
  await sql`
    create table if not exists fund_positions (
      wallet text not null,
      agent text not null,
      shares numeric not null default 0,
      principal numeric not null default 0,
      updated_at timestamptz not null default now(),
      primary key (wallet, agent)
    )`;
  await sql`
    create table if not exists fund_events (
      id bigserial primary key,
      wallet text not null,
      agent text,
      kind text not null,
      usd numeric not null,
      fee numeric not null default 0,
      shares numeric not null default 0,
      nav numeric,
      status text not null,
      signature text unique,
      last_valid_block_height bigint,
      created_at timestamptz not null default now()
    )`;
  await sql`create index if not exists fund_events_wallet on fund_events (wallet, id desc)`;
  await sql`
    create table if not exists fund_bonuses (
      wallet text primary key,
      agent text not null,
      deposit_usd numeric not null,
      usd numeric not null,
      unlock_at timestamptz not null,
      status text not null,
      signature text,
      created_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists fund_intents (
      id text primary key,
      wallet text not null,
      agent text not null,
      usd numeric not null,
      status text not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )`;

  // Columns added after the first version of the tables.
  await sql`alter table fund_events add column if not exists nonce text unique`;
  await sql`alter table fund_events add column if not exists principal numeric not null default 0`;
  await sql`alter table fund_bonuses add column if not exists last_valid_block_height bigint`;
  await sql`alter table fund_intents add column if not exists message_hash text`;
  await sql`alter table fund_events add column if not exists intent text`;
}

/** The query function, once the tables exist. */
export async function db(): Promise<Sql> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!shared.__db) {
    const sql = neon(process.env.DATABASE_URL);
    shared.__db = { sql, ready: migrate(sql) };
    // A failed migration should be retried on the next call, not cached forever.
    shared.__db.ready.catch(() => (shared.__db = undefined));
  }
  await shared.__db.ready;
  return shared.__db.sql;
}

/** Postgres returns numerics as strings. */
export const num = (v: unknown) => Number(v ?? 0);
