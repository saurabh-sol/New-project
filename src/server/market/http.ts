/** Shared by the market data modules: a short-lived cache and a patient fetch. */

const shared = globalThis as typeof globalThis & { __marketCache?: Map<string, { at: number; value: Promise<unknown> }> };

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

/** Waits between tries, in ms. A caller that can afford to wait out "too many requests" is `patient`. */
const WAITS = { quick: [700, 1500], patient: [3_000, 8_000, 15_000] };

/** These services time out or ask for patience now and then, so a request is tried more than once. */
export async function getJson<T>(url: string, patient = false): Promise<T> {
  const waits = patient ? WAITS.patient : WAITS.quick;
  let problem: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, waits[attempt - 1]));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; TheCouncil/1.0)" } });
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
