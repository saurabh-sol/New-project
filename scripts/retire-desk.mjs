/**
 * Closes the desk contract the four agents used to share, now that each has one of its own.
 *
 *   node --env-file=.env.local scripts/retire-desk.mjs 0x<the old contract>
 *
 * Every position on the old contract is sold at what it cost, so no gain or loss is settled,
 * and every agent's cash is released. All of its USDG goes back to the treasury. The books
 * are not touched: the positions live on, on the agents' own contracts.
 *
 * Run it after the server has started with the new contracts. Until then the server would
 * put the money back.
 */
import "./dns-fallback.mjs";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, keccak256, parseAbi, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";

const old = process.argv[2];
if (!old || !/^0x[0-9a-fA-F]{40}$/.test(old)) throw new Error("Name the old contract: node scripts/retire-desk.mjs 0x...");
if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set in .env.local");
for (const a of ["QUANT", "DEGEN", "GUARDIAN", "ORACLE"]) {
  if ((process.env[`DESK_${a}`] ?? "").toLowerCase() === old.toLowerCase()) throw new Error("That is one of the agents' own contracts, which are in use.");
}

const chain = process.env.ROBINHOOD_NETWORK === "mainnet" ? robinhood : robinhoodTestnet;
const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 20_000 });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const desk = getAddress(old);
const { abi } = JSON.parse(readFileSync(new URL("../contracts/CouncilDesk.json", import.meta.url), "utf8"));
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"]);
const read = (functionName, args = []) => pub.readContract({ address: desk, abi, functionName, args });

async function sent(what, functionName, args) {
  for (let attempt = 1; ; attempt++) {
    try {
      const receipt = await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: desk, abi, functionName, args }), timeout: 120_000 });
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

const usdg = await read("usdg");
const decimals = await pub.readContract({ address: usdg, abi: erc20, functionName: "decimals" });
const held = () => pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [desk] });
const usd = (units) => formatUnits(units, decimals);
console.log(`The old desk ${desk} on ${chain.name} holds ${usd(await held())} USDG.`);

for (const token of await read("holdings")) {
  const [qty, cost, stake] = await read("position", [token]);
  // Sold at cost: each agent gets back what it put in, and nothing is settled with the treasury.
  const price = (cost * 10n ** 36n) / (qty * 10n ** BigInt(decimals));
  const trade = { id: keccak256(toBytes(`retire-${token}`)), round: 0, token, symbol: "", price, qty, amounts: [...stake], tag: 0 };
  await sent(`closing the position in ${token} at its cost of ${usd(cost)}`, "sell", [trade]);
}

const [cash] = await read("balances");
for (const [agent, amount] of cash.entries()) {
  if (amount > 0n) await sent(`releasing agent ${agent}'s ${usd(amount)} USDG`, "release", [agent, amount]);
}
if ((await held()) > 0n && (await read("owner")).toLowerCase() === account.address.toLowerCase()) await sent("sweeping what is left", "sweep", []);

console.log(`The old desk now holds ${usd(await held())} USDG. It keeps its record of past trades.`);
process.exit(0);
