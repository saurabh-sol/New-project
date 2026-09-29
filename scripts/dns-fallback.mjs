/**
 * Name lookups that don't give up too early, for the scripts in this folder.
 * The server has the same thing in src/server/dns-fallback.ts, where it is explained.
 */
import dns from "node:dns";

const publicDns = new dns.Resolver({ timeout: 3_000, tries: 2 });
publicDns.setServers(["1.1.1.1", "8.8.8.8"]);
const ask = (resolver, host) => new Promise((resolve, reject) => resolver.resolve4(host, (err, found) => (err || !found.length ? reject(err ?? new Error("no address")) : resolve(found))));

const system = dns.lookup.bind(dns);
dns.lookup = (host, second, third) => {
  const cb = typeof second === "function" ? second : third;
  const options = typeof second === "number" ? { family: second } : typeof second === "object" && second ? second : {};
  system(host, options, (err, address, family) => {
    const missing = err && (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN");
    if (!missing || options.family === 6) return cb(err, address, family);
    ask(dns, host)
      .catch(() => ask(publicDns, host))
      .then(
        (found) => (options.all ? cb(null, found.map((a) => ({ address: a, family: 4 }))) : cb(null, found[0], 4)),
        () => cb(err),
      );
  });
};
