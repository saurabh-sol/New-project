/**
 * Takes the desk's money out. Every agent's USDG goes from its desk contract back to the
 * treasury, and from there, if a wallet is named, to that wallet.
 *
 *   node --env-file=.env.local scripts/cash-out.mjs --dry-run
 *   node --env-file=.env.local scripts/cash-out.mjs --to 0x<your wallet>
 *
 * It first takes back the contracts' leave to draw USDG from the treasury, so that a server
 * which is still running can't put the money in again. Then, on each desk, every position is
 * closed at what it cost, so no gain or loss is settled, and the agent's cash is released.
 * The desks stay registered and keep their record of past trades.
 *
 * Without --to the USDG stays in the treasury. With --keep <usd> that much is left there.
 * With --dry-run nothing is sent: it says what each step would move.
 *
 * Stop the server first if you can: it signs with the same key, and two signers can take
 * each other's place in the treasury's queue. The books are not touched. To trade again
 * afterwards, send the USDG back to the treasury, run scripts/deploy-desks.mjs to give the
 * contracts their leave again, and start the server on new books.
 */
import "./dns-fallback.mjs";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, isAddress, keccak256, parseAbi, parseUnits, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";

const AGENTS = ["QUANT", "DEGEN", "GUARDIAN", "ORACLE"];
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const dry = process.argv.includes("--dry-run");
const to = arg("--to");
const keep = arg("--keep") ?? "0";

if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set");
const desks = AGENTS.map((a) => process.env[`DESK_${a}`]);
if (!desks.every((d) => d && isAddress(d, { strict: false }))) throw new Error("DESK_QUANT, DESK_DEGEN, DESK_GUARDIAN and DESK_ORACLE must all be set.");
if (to !== null && !isAddress(to ?? "", { strict: false })) throw new Error("--to must be a wallet address: 0x and 40 characters.");
if (!(Number(keep) >= 0)) throw new Error("--keep must be an amount of USDG.");

const chain = process.env.ROBINHOOD_NETWORK === "mainnet" ? robinhood : robinhoodTestnet;
const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 20_000 });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const abi = JSON.parse(readFileSync(new URL("../contracts/AgentDesk.json", import.meta.url), "utf8")).abi;
const erc20 = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

async function sent(what, address, contract, functionName, args) {
  if (dry) return console.log(`  would be ${what}`);
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

const usdg = getAddress(await pub.readContract({ address: getAddress(desks[0]), abi, functionName: "usdg" }));
const decimals = await pub.readContract({ address: usdg, abi: erc20, functionName: "decimals" });
const usd = (units) => formatUnits(units, decimals);
const holds = (owner) => pub.readContract({ address: usdg, abi: erc20, functionName: "balanceOf", args: [owner] });

if (to && [usdg, ...desks.map((d) => getAddress(d))].includes(getAddress(to))) throw new Error("--to names the token or a desk. Name a wallet of yours.");

const before = await holds(account.address);
console.log(`${dry ? "A dry run: nothing is sent.\n" : ""}Treasury ${account.address} on ${chain.name} holds ${usd(before)} USDG.`);

let expected = before;
for (const raw of desks) {
  const desk = getAddress(raw);
  const read = (functionName, args = []) => pub.readContract({ address: desk, abi, functionName, args });
  const [name, its, treasury, operator] = await Promise.all([read("agent"), read("usdg"), read("treasury"), read("operator")]);
  if (getAddress(its) !== usdg) throw new Error(`${name}'s desk is in a different token from the others.`);
  if (getAddress(treasury) !== account.address || getAddress(operator) !== account.address) throw new Error(`${name}'s desk ${desk} is not run by this key. Its treasury is ${treasury} and its operator ${operator}.`);
  const held = await holds(desk);
  expected += held;
  console.log(`${name}'s desk ${desk} holds ${usd(held)} USDG.`);

  if ((await pub.readContract({ address: usdg, abi: erc20, functionName: "allowance", args: [account.address, desk] })) > 0n) {
    await sent("taking back its leave to draw USDG", usdg, erc20, "approve", [desk, 0n]);
  }
  for (const token of await read("holdings")) {
    const [qty, cost] = await read("position", [token]);
    // Sold at cost: the agent gets back what it put in, and nothing is settled with the treasury.
    const price = (cost * 10n ** 36n) / (qty * 10n ** BigInt(decimals));
    const trade = { id: keccak256(toBytes(`cash-out-${desk}-${token}-${qty}`)), round: 0, token, symbol: "", price, qty, usd: cost, reason: 0 };
    await sent(`closing the position in ${token} at its cost of ${usd(cost)}`, desk, abi, "sell", [trade]);
  }
  const cash = dry ? held : await read("cash");
  if (cash > 0n) await sent(`releasing ${usd(cash)} USDG`, desk, abi, "release", [cash]);
  if (!dry && (await holds(desk)) > 0n && getAddress(await read("owner")) === account.address) await sent("sweeping what is left", desk, abi, "sweep", []);
}

const back = dry ? expected : await holds(account.address);
console.log(`The treasury ${dry ? "would hold" : "now holds"} ${usd(back)} USDG.`);
if (!dry && back !== expected) console.log(`  That is not the ${usd(expected)} that was expected. Look at the desks before sending anything on.`);

if (to) {
  const left = parseUnits(keep, decimals);
  if (back > left) await sent(`sending ${usd(back - left)} USDG to ${getAddress(to)}`, usdg, erc20, "transfer", [getAddress(to), back - left]);
  if (!dry) console.log(`${getAddress(to)} now holds ${usd(await holds(getAddress(to)))} USDG, and the treasury ${usd(await holds(account.address))}.`);
}
process.exit(0);
