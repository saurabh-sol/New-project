/** Small helpers the chain adapters share. State lives on globalThis so every route bundle sees the same copy. */

const shared = globalThis as typeof globalThis & {
  __chainQueues?: Map<string, Promise<unknown>>;
  __chainProblems?: Map<string, { at: number; value: string | null }>;
};

/** Runs tasks with the same name one after another. */
export function queue<T>(name: string, task: () => Promise<T>): Promise<T> {
  const queues = (shared.__chainQueues ??= new Map());
  const run = (queues.get(name) ?? Promise.resolve()).then(task);
  queues.set(
    name,
    run.catch(() => {}),
  );
  return run;
}

const FRESH_MS = 30_000;

/** Remembers the answer to a slow readiness check for half a minute. */
export async function problemCache(key: string, check: () => Promise<string | null>): Promise<string | null> {
  const cache = (shared.__chainProblems ??= new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.value;
  const value = await check();
  cache.set(key, { at: Date.now(), value });
  return value;
}
