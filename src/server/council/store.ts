/**
 * The council's shared state: one portfolio that every viewer sees.
 * Stored as a JSON file, which is fine for a single server. Move it to a
 * database before deploying to serverless hosting, where local files don't persist.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { newPortfolio, type Fill, type Portfolio } from "@/lib/council";

export interface CouncilState {
  round: number;
  portfolio: Portfolio;
  fills: Fill[];
  /** One line per finished round, newest last, given to the agents as memory. */
  recent: string[];
  lastRoundAt: number;
  lastRiskCheck: number;
  /** UTC date of `roundsToday`, e.g. "2026-09-28". */
  day: string;
  roundsToday: number;
}

const FILE = path.join(process.cwd(), ".data", "council.json");
const MAX_FILLS = 100;
const MAX_RECENT = 5;

const fresh = (): CouncilState => ({
  round: 0,
  portfolio: newPortfolio(),
  fills: [],
  recent: [],
  lastRoundAt: 0,
  lastRiskCheck: Date.now(),
  day: today(),
  roundsToday: 0,
});

export const today = () => new Date().toISOString().slice(0, 10);

async function load(): Promise<CouncilState> {
  try {
    return { ...fresh(), ...(JSON.parse(await readFile(FILE, "utf8")) as CouncilState) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fresh();
    throw e;
  }
}

async function save(state: CouncilState) {
  await mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, FILE);
}

// Shared across route bundles, so every read-modify-write goes through one queue.
const shared = globalThis as typeof globalThis & { __councilQueue?: Promise<unknown> };

/** Runs `fn` with exclusive access to the state and saves whatever it returns. */
export function updateState(fn: (state: CouncilState) => Promise<CouncilState> | CouncilState): Promise<CouncilState> {
  const run = (shared.__councilQueue ?? Promise.resolve()).then(async () => {
    const next = await fn(await load());
    next.fills = next.fills.slice(-MAX_FILLS);
    next.recent = next.recent.slice(-MAX_RECENT);
    await save(next);
    return next;
  });
  shared.__councilQueue = run.catch(() => {});
  return run;
}

export const readState = () => updateState((s) => s);
