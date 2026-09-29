/**
 * Name lookups that don't give up too early.
 *
 * On some networks the system's lookup fails now and then for a host that a plain DNS query
 * finds at once. When that happens here, the address is fetched by a direct query instead:
 * first from the network's own DNS server, then from public ones.
 */
import dns from "node:dns";

type Callback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;

const shared = globalThis as typeof globalThis & { __dnsFallback?: boolean };
const KEEP_MS = 5 * 60_000;
const known = new Map<string, { at: number; addresses: string[] }>();

const publicDns = new dns.Resolver({ timeout: 3_000, tries: 2 });
publicDns.setServers(["1.1.1.1", "8.8.8.8"]);

const ask = (resolver: Pick<dns.Resolver, "resolve4">, host: string) =>
  new Promise<string[]>((resolve, reject) => resolver.resolve4(host, (err, addresses) => (err || !addresses.length ? reject(err ?? new Error("no address")) : resolve(addresses))));

async function direct(host: string): Promise<string[]> {
  const hit = known.get(host);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.addresses;
  const addresses = await ask(dns, host).catch(() => ask(publicDns, host));
  known.set(host, { at: Date.now(), addresses });
  return addresses;
}

export function installDnsFallback() {
  if (shared.__dnsFallback) return;
  shared.__dnsFallback = true;
  const system = dns.lookup.bind(dns) as (host: string, options: dns.LookupOptions, cb: Callback) => void;

  const lookup = (host: string, second: unknown, third?: unknown) => {
    const cb = (typeof second === "function" ? second : third) as Callback;
    const options: dns.LookupOptions = typeof second === "number" ? { family: second } : typeof second === "object" && second ? (second as dns.LookupOptions) : {};

    system(host, options, (err, address, family) => {
      const missing = err && (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN");
      const wantsV6 = options.family === 6 || options.family === "IPv6";
      if (!missing || wantsV6) return cb(err, address, family);
      direct(host).then(
        (found) => (options.all ? cb(null, found.map((a) => ({ address: a, family: 4 }))) : cb(null, found[0], 4)),
        () => cb(err),
      );
    });
  };
  (dns as { lookup: unknown }).lookup = lookup;
}
