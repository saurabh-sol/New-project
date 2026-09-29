/** Shared by the market data modules: a short-lived cache and a patient fetch. */

const shared = globalThis as typeof globalThis & {
  __marketCache?: Map<string, { at: number; value: Promise<unknown> }>;
  __marketKept?: Map<string, { at: number; value: unknown }>;
  __marketTurns?: Map<string, Promise<unknown>>;
};

const FAILED_MS = 10_000;

/**
 * Reuses an answer for `freshMs`. The data services limit how often they may be asked,
 * and every viewer and every risk check draws on the same allowance.
 */
export function cached<T>(key: string, freshMs: number, load: () => Promise<T>): Promise<T> {
  const cache = (shared.__marketCache ??= new Map());
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < freshMs) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  // A failure is remembered too, briefly: asking again at once only makes a busy service busier.
  value.catch(() => cache.get(key)?.value === value && cache.set(key, { at: Date.now() - freshMs + Math.min(freshMs, FAILED_MS), value }));
  if (cache.size > 300) for (const [k, v] of cache) if (Date.now() - v.at > 600_000) cache.delete(k);
  return value;
}

/**
 * Like `cached`, and when the answer can't be had, the last good one stands in for it, for
 * up to `keepMs`. A chart that is a few minutes old is still the chart.
 */
export async function cachedOrKept<T>(key: string, freshMs: number, keepMs: number, load: () => Promise<T>): Promise<T> {
  const kept = (shared.__marketKept ??= new Map());
  try {
    const value = await cached(key, freshMs, load);
    kept.set(key, { at: Date.now(), value });
    if (kept.size > 300) for (const [k, v] of kept) if (Date.now() - v.at > 3_600_000) kept.delete(k);
    return value;
  } catch (e) {
    const last = kept.get(key);
    if (last && Date.now() - last.at < keepMs) return last.value as T;
    throw e;
  }
}

/**
 * Services that allow few requests a minute, and the least time between two requests to each.
 * Requests sent all at once are what they refuse first.
 */
const PACED: Record<string, number> = { "api.geckoterminal.com": 350 };

/** Runs `task` once every earlier request to the same service has left, and a moment has passed. */
function inTurn<T>(host: string, task: () => Promise<T>): Promise<T> {
  const gap = PACED[host];
  if (!gap) return task();
  const turns = (shared.__marketTurns ??= new Map());
  const before = turns.get(host) ?? Promise.resolve();
  const leave = before.then(() => new Promise((r) => setTimeout(r, gap)));
  turns.set(host, leave);
  return before.then(task);
}

/** Waits between tries, in ms. A caller that can afford to wait out "too many requests" is `patient`. */
const WAITS = { quick: [700, 1500], patient: [3_000, 8_000, 15_000] };

/** These services time out or ask for patience now and then, so a request is tried more than once. */
export async function getJson<T>(url: string, patient = false): Promise<T> {
  const waits = patient ? WAITS.patient : WAITS.quick;
  let problem: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, waits[attempt - 1]));
    try {
      const res = await inTurn(new URL(url).host, () => fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; TheCouncil/1.0)" } }));
      if (res.ok) return (await res.json()) as T;
      problem = new Error(`Market data request failed (${res.status})`);
      // Anything but "too many requests" or a server fault will fail the same way again.
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      problem = e;
    }
  }
  throw problem;
}
