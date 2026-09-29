/**
 * Closes desk contracts that have been replaced, and returns their USDG to the treasury.
 *
 *   node --env-file=.env.local scripts/retire-desks.mjs 0x<desk> [0x<desk> ...]
 *
 * Every position on each desk is sold at what it cost, so no gain or loss is settled, and the
 * agent's cash is released. The desk is then struck off the share book. The books are not
 * touched: the positions live on, on the desks that replaced these.
 *
 * Run it after the server has started with the new desks. Until then the server would put
 * the money back.
 */
import "./dns-fallback.mjs";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, keccak256, parseAbi, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";

const old = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
if (old.length === 0) throw new Error("Name the desks to close: node scripts/retire-desks.mjs 0x... 0x...");
if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set");
const inUse = ["QUANT", "DEGEN", "GUARDIAN", "ORACLE"].map((a) => (process.env[`DESK_${a}`] ?? "").toLowerCase());
for (const desk of old) if (inUse.includes(desk.toLowerCase())) throw new Error(`${desk} is one of the desks in use.`);

const chain = process.env.ROBINHOOD_NETWORK === "mainnet" ? robinhood : robinhoodTestnet;
const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 20_000 });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const artifact = (name) => JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8")).abi;
const abi = artifact("AgentDesk");
const book = artifact("CouncilShares");
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);

async function sent(what, address, contract, functionName, args) {
  for (let attempt = 1; ; attempt++) {
    try {
      const receipt = await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address, abi: contract, functionName, args }), timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${what} failed on-chain`);
      console.log(`  ${what}: ${receipt.transactionHash}`);
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  ${what}: ${e.shortMessage ?? e.message}. Trying again.`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

for (const raw of old) {
  const desk = getAddress(raw);
  const read = (functionName, args = []) => pub.readContract({ address: desk, abi, functionName, args });
  const [name, usdg, shares] = await Promise.all([read("agent"), read("usdg"), read("shares")]);
  const decimals = await pub.readContract({ address: usdg, abi: erc20, functionName: "decimals" });
  const held = () => pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [desk] });
  const usd = (units) => formatUnits(units, decimals);
  console.log(`${name}'s old desk ${desk} on ${chain.name} holds ${usd(await held())} USDG.`);

  for (const token of await read("holdings")) {
    const [qty, cost] = await read("position", [token]);
    // Sold at cost: the agent gets back what it put in, and nothing is settled with the treasury.
    const price = (cost * 10n ** 36n) / (qty * 10n ** BigInt(decimals));
    const trade = { id: keccak256(toBytes(`retire-${desk}-${token}`)), round: 0, token, symbol: "", price, qty, usd: cost, reason: 0 };
    await sent(`closing the position in ${token} at its cost of ${usd(cost)}`, desk, abi, "sell", [trade]);
  }
  const cash = await read("cash");
  if (cash > 0n) await sent(`releasing ${usd(cash)} USDG`, desk, abi, "release", [cash]);
  if ((await held()) > 0n && (await read("owner")).toLowerCase() === account.address.toLowerCase()) await sent("sweeping what is left", desk, abi, "sweep", []);
  if (await pub.readContract({ address: shares, abi: book, functionName: "isDesk", args: [desk] })) await sent("striking it off the share book", shares, book, "setDesk", [desk, false]);
  console.log(`  It now holds ${usd(await held())} USDG, and keeps its record of past trades.`);
}
process.exit(0);
