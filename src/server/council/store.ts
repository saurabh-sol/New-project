/**
 * The council's shared state: one portfolio that every viewer sees.
 *
 * Kept in Postgres when DATABASE_URL is set, so it survives restarts and is shared
 * between server instances. Without a database it falls back to a local JSON file,
 * which only suits a single server.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeskAsset } from "@/lib/assets";
import type { Network } from "@/lib/chains";
import { newPortfolio, normalizePortfolio, type Fill, type Portfolio } from "@/lib/council";
import type { AssetKey } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { networkOf } from "../chains/robinhood";
import { db, hasDb } from "../db";

export interface CouncilState {
  /** The network these books were made on. Books are never carried from one network to the other. */
  network: Network;
  round: number;
  portfolio: Portfolio;
  /** Tokens the desk knows: those on its board, those it holds, and those funders asked for. By the name the desk uses for each. */
  assets: Record<AssetKey, DeskAsset>;
  /** The tokens the agents chose from in the latest session: the ones trending then. */
  board?: AssetKey[];
  /** Set once the ETH and Stock Tokens the agents had bought on their own were sold, when the desk stopped trading them. */
  woundDown?: boolean;
  fills: Fill[];
  /** One line per finished round, newest last, given to the agents as memory. */
  recent: string[];
  /** The focus each agent was given in its latest rounds, newest last, so it is not handed the same one again. */
  lenses: Record<AgentId, string[]>;
  lastRoundAt: number;
  lastRiskCheck: number;
  /** The desk contract that records trades, and when it took over. Trades from before then are not on-chain. */
  desk?: { address: string; since: number };
  /** Set once the desk trades on the market, from the agents' wallets. Trades from before then were settled against the treasury. */
  real?: { since: number };
  /** A position the agents hold together that is up enough to put its sale to a vote. The next session is called at once, and votes on it. */
  sellCall?: { token: AssetKey; at: number; pnl: number };
  /** When a vote on selling each position was last called, so the same one is not called over and over. */
  called?: Record<AssetKey, number>;
  /** UTC date of `roundsToday`, e.g. "2026-09-28". */
  day: string;
  roundsToday: number;
}

export interface Versioned {
  state: CouncilState;
  version: number;
}

const FILE = path.join(process.cwd(), ".data", "council.json");
const MAX_FILLS = 100;
const MAX_RECENT = 5;
/** Tokens the desk no longer holds are remembered up to this many, so their past trades can still be charted. */
const MAX_IDLE_ASSETS = 20;
const MAX_ATTEMPTS = 8;

export const today = () => new Date().toISOString().slice(0, 10);

const fresh = (): CouncilState => ({
  network: networkOf(),
  round: 0,
  portfolio: newPortfolio(),
  assets: {},
  fills: [],
  recent: [],
  lenses: { quant: [], degen: [], guardian: [], oracle: [] },
  lastRoundAt: 0,
  lastRiskCheck: Date.now(),
  day: today(),
  roundsToday: 0,
});

const hydrate = (raw: Partial<CouncilState>): CouncilState => {
  // Books saved before the network was noted were made on the testnet.
  const base = { ...fresh(), ...raw, network: raw.network ?? "testnet" };
  // Test money must never be read as real money, nor the other way round.
  if (base.network !== networkOf()) {
    throw new Error(`These books were made on Robinhood Chain ${base.network}, and the server is set to ${networkOf()}. Point DATABASE_URL at the ${networkOf()} books, or at an empty database to start new ones.`);
  }
  return { ...base, portfolio: normalizePortfolio(base.portfolio) };
};

function trimAssets(s: CouncilState): CouncilState["assets"] {
  const all = Object.values(s.assets);
  if (all.length <= MAX_IDLE_ASSETS) return s.assets;
  const held = new Set([...s.portfolio.positions.map((p) => p.token), ...(s.board ?? [])]);
  const idle = all.filter((a) => !held.has(a.key)).sort((a, b) => b.quotedAt - a.quotedAt);
  const keep = [...all.filter((a) => held.has(a.key)), ...idle.slice(0, MAX_IDLE_ASSETS)];
  return Object.fromEntries(keep.map((a) => [a.key, a]));
}

export const trimmed = (s: CouncilState): CouncilState => ({ ...s, assets: trimAssets(s), fills: s.fills.slice(-MAX_FILLS), recent: s.recent.slice(-MAX_RECENT) });

// --- file backend ---

let fileVersion = 0;

async function readFileState(): Promise<Versioned> {
  try {
    return { state: hydrate(JSON.parse(await readFile(FILE, "utf8")) as CouncilState), version: fileVersion };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: fresh(), version: fileVersion };
    throw e;
  }
}

async function writeFileState(state: CouncilState, version: number): Promise<boolean> {
  if (version !== fileVersion) return false;
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, FILE);
  fileVersion++;
  return true;
}

// --- Postgres backend ---

async function readDbState(): Promise<Versioned> {
  const sql = await db();
  await sql`insert into council_state (id, version, data) values (1, 0, ${JSON.stringify(fresh())}::jsonb) on conflict (id) do nothing`;
  const [row] = await sql`select data, version from council_state where id = 1`;
  return { state: hydrate(row.data as CouncilState), version: Number(row.version) };
}

async function writeDbState(state: CouncilState, version: number): Promise<boolean> {
  const sql = await db();
  const rows = await sql`
    update council_state set data = ${JSON.stringify(state)}::jsonb, version = version + 1, updated_at = now()
    where id = 1 and version = ${version}
    returning version`;
  return rows.length === 1;
}

export const readVersioned = (): Promise<Versioned> => (hasDb() ? readDbState() : readFileState());
const write = (state: CouncilState, version: number) => (hasDb() ? writeDbState(state, version) : writeFileState(state, version));

// Requests on this server take turns; the version check covers other servers.
const shared = globalThis as typeof globalThis & { __councilQueue?: Promise<unknown> };

/** Runs `task` after every earlier state change on this server has finished. */
export function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = (shared.__councilQueue ?? Promise.resolve()).then(task);
  shared.__councilQueue = run.catch(() => {});
  return run;
}

/**
 * Changes the state and saves it. If another server saved in between, `fn` runs again
 * on the newer state, so `fn` must not have side effects.
 */
export function updateState(fn: (state: CouncilState) => Promise<CouncilState> | CouncilState): Promise<CouncilState> {
  return inTurn(async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { state, version } = await readVersioned();
      const out = await fn(state);
      if (out === state) return state;
      const next = trimmed(out);
      if (await write(next, version)) return next;
    }
    throw new Error("Could not save the council state: too many concurrent changes");
  });
}

export const readState = async () => (await readVersioned()).state;
