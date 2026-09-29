/**
 * Trade requests: a funder may ask the agent they fund to trade a token on Robinhood Chain.
 * A request waits in a queue and is heard by the council one per session, oldest first.
 */
import type { Asset, AssetPreview, AssetQuote, RequestBrief, RequestMode, RequestStatus, TradeRequest } from "@/lib/assets";
import { requestMode } from "@/lib/assets";
import type { TokenStats } from "@/lib/council-types";
import type { AssetKey } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { nameOf } from "../council/context";
import { assetStats } from "../council/stats";
import { db, hasDb, num } from "../db";
import { fundConfig } from "../fund/config";
import { assetCandles, assetQuote, longKey, lookupAsset, tooThin } from "../market/assets";

type Row = Record<string, unknown>;

/** A request is given this many sessions before it is dropped, when sessions break or its market data can't be reached. */
const MAX_ATTEMPTS = 6;
const GAVE_UP = "The council could not hear this request: its sessions broke off, or the token's market data could not be reached.";
/** The chart the agents read, as `assetStats` asks for it, and how much of it they need. */
const STATS_SPAN = "5m";
const STATS_CANDLES = 60;
const STATS_NEEDS = 30;
/** How many unusable requests one session will go through before it carries on without one. */
const MAX_SKIPS = 3;

const toRequest = (r: Row): TradeRequest => ({
  id: num(r.id),
  agent: r.agent as AgentId,
  asset: r.asset as Asset,
  mode: r.mode as RequestMode,
  usd: num(r.usd),
  status: r.status as RequestStatus,
  round: r.round === null || r.round === undefined ? null : num(r.round),
  note: (r.note as string | null) ?? null,
  ts: new Date(r.created_at as string).getTime(),
});

/** `token` is a contract address on Robinhood Chain, or a Stock Token's symbol. */
export async function previewAsset(token: unknown): Promise<AssetPreview> {
  if (typeof token !== "string" || !token.trim()) return { ok: false, error: "Enter a token's address or a Stock Token's symbol." };
  const found = await lookupAsset(token);
  if (!found.ok || found.asset.kind !== "pool") return found;
  // The agents read a token's chart before they trade it. Better to say so now than after the deposit.
  const candles = await assetCandles(found.asset, STATS_SPAN, STATS_CANDLES).catch(() => null);
  if (candles && candles.length < STATS_NEEDS) {
    return { ok: false, error: `${found.asset.symbol} has under three hours of trading on record. That is too little for the agents to read, so try again later.` };
  }
  return found;
}

/** What is stored with a deposit that carries a request, until the deposit is paid. */
export interface PendingRequest {
  asset: Asset;
  mode: RequestMode;
}

/** Checks a request before the deposit that carries it is prepared. */
export async function checkRequest(wallet: string, address: unknown, usd: number): Promise<{ ok: true; request: PendingRequest } | { ok: false; error: string }> {
  const found = await previewAsset(address);
  if (!found.ok) return found;
  const sql = await db();
  const open = await sql`select 1 from trade_requests where wallet = ${wallet} and status in ('pending', 'presenting') limit 1`;
  if (open.length) return { ok: false, error: "You already have a request waiting to be heard. You can send another once the council has decided on it." };
  return { ok: true, request: { asset: found.asset, mode: requestMode(usd, fundConfig().terms.commitFrom) } };
}

/** Puts a paid deposit's request in the queue. Safe to call twice for the same deposit. */
export async function openRequest(intent: Row): Promise<TradeRequest | null> {
  const pending = intent.request as PendingRequest | null;
  if (!pending) return null;
  const sql = await db();
  // One request per wallet waits at a time, even if two deposits were prepared side by side.
  await sql`
    insert into trade_requests (wallet, agent, intent, asset, mode, usd, status)
    select ${intent.wallet as string}, ${intent.agent as string}, ${intent.id as string}, ${JSON.stringify(pending.asset)}::jsonb, ${pending.mode}, ${num(intent.usd)}, 'pending'
    where not exists (select 1 from trade_requests where wallet = ${intent.wallet as string} and status in ('pending', 'presenting'))
    on conflict (intent) do nothing`;
  const [row] = await sql`select * from trade_requests where intent = ${intent.id as string}`;
  return row ? toRequest(row) : null;
}

export async function requestsFor(wallet: string): Promise<TradeRequest[]> {
  const sql = await db();
  return (await sql`select * from trade_requests where wallet = ${wallet} order by id desc limit 5`).map(toRequest);
}

// --- the council's side ---

/** A request the current session is hearing. */
export interface ActiveRequest {
  id: number;
  brief: RequestBrief;
  /** Market figures for the requested token, in the same form as every other token's. */
  stats: TokenStats;
  quote: AssetQuote;
}

/** Where a session gets its requests. Replaceable so a session can be tested without a database. */
export interface RequestSource {
  /** `market1h` is the stock market's move over the last hour, which a Stock Token is measured against. */
  take(round: number, cash: Record<AgentId, number>, taken: Record<AssetKey, { address: string }>, market1h: number): Promise<ActiveRequest | null>;
  finish(id: number, status: "executed" | "rejected" | "failed", note: string): Promise<void>;
  /** The session broke. The request goes back in the queue, unless it has been tried too often. */
  release(id: number): Promise<void>;
}

async function finish(id: number, status: "executed" | "rejected" | "failed", note: string): Promise<void> {
  const sql = await db();
  await sql`update trade_requests set status = ${status}, note = ${note} where id = ${id}`;
}

async function take(round: number, cash: Record<AgentId, number>, taken: Record<AssetKey, { address: string }>, market1h: number): Promise<ActiveRequest | null> {
  if (!hasDb()) return null;
  const sql = await db();
  // A request left mid-session by a server that stopped.
  await sql`update trade_requests set status = 'pending' where status = 'presenting' and round < ${round} and attempts < ${MAX_ATTEMPTS}`;
  await sql`update trade_requests set status = 'failed', note = ${GAVE_UP} where status = 'presenting' and round < ${round}`;

  // Requests for a Stock Token wait while its market is closed. Those behind them in the queue go ahead.
  let after = 0;
  for (let skipped = 0; skipped < MAX_SKIPS; skipped++) {
    const [row] = await sql`
      update trade_requests set status = 'presenting', round = ${round}, attempts = attempts + 1
      where id = (select id from trade_requests where status = 'pending' and id > ${after} order by id limit 1 for update skip locked)
      returning *`;
    if (!row) return null;
    const request = toRequest(row);
    after = request.id;
    const { id, agent, usd, mode } = request;
    const refuse = async (status: "rejected" | "failed", note: string) => finish(id, status, note);

    // The funding that earned the request must still be with the agent.
    const [pos] = await sql`select principal from fund_positions where wallet = ${row.wallet as string} and agent = ${agent}`;
    if (num(pos?.principal) < usd - 0.01) {
      await refuse("rejected", "The funding behind this request was withdrawn before the council heard it.");
      continue;
    }
    if (cash[agent] < 10) {
      await refuse("failed", `${nameOf(agent)} had no cash free when the request came up.`);
      continue;
    }

    try {
      const quote = await assetQuote(request.asset);
      if (quote.session === "closed") {
        await sql`update trade_requests set status = 'pending', attempts = greatest(attempts - 1, 0), round = null where id = ${id}`;
        continue;
      }
      const thin = request.asset.kind === "pool" ? tooThin(request.asset.symbol, quote) : null;
      if (thin) {
        await refuse("rejected", thin);
        continue;
      }
      // Two tokens can share a symbol. The second one to reach the desk gets a longer name.
      const clash = taken[request.asset.key];
      const asset = clash && clash.address.toLowerCase() !== request.asset.address.toLowerCase() ? { ...request.asset, key: longKey(request.asset) } : request.asset;
      const stats = await assetStats(asset, quote, market1h);
      if (!stats) {
        await refuse("failed", `${asset.symbol} has too little trading history to read.`);
        continue;
      }
      return { id, stats, quote, brief: { agent, asset, mode, usd, liquidityUsd: quote.liquidityUsd, volume24hUsd: quote.volume24hUsd } };
    } catch (e) {
      // Most likely a passing fault. The request keeps its place and is heard at a later session.
      console.error("[requests] could not read the requested token:", e instanceof Error ? e.message : e);
      await release(id);
      return null;
    }
  }
  return null;
}

async function release(id: number): Promise<void> {
  const sql = await db();
  await sql`
    update trade_requests
    set status = case when attempts < ${MAX_ATTEMPTS} then 'pending' else 'failed' end,
        note = case when attempts < ${MAX_ATTEMPTS} then null else ${GAVE_UP} end
    where id = ${id} and status = 'presenting'`;
}

export const liveRequests: RequestSource = { take, finish, release };
