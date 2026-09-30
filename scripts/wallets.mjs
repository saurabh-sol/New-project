/**
 * The agents' wallets: the contracts the desk trades on the market from (contracts/AgentWallet.sol).
 *
 *   node --env-file=.data/mainnet.env scripts/wallets.mjs deploy --env .data/mainnet.env
 *   node --env-file=.data/mainnet.env scripts/wallets.mjs status
 *   node --env-file=.data/mainnet.env scripts/wallets.mjs cash-out [--to 0x<wallet>] [--tokens 0x..,0x..]
 *
 * deploy    Deploys a wallet for each agent, caps a purchase, gives each its starting USDG from
 *           the treasury, and writes WALLET_QUANT, WALLET_DEGEN, WALLET_GUARDIAN and WALLET_ORACLE
 *           to the env file. It can be run again if it broke off: what is written is not deployed twice.
 *           The starting USDG is NEXT_PUBLIC_START_CASH, 20 if it is not set. The cap on a purchase
 *           is a quarter of it.
 * status    Says what the treasury and each wallet hold. Sends nothing.
 * cash-out  Takes every wallet's USDG back to the treasury, or to the wallet named with --to.
 *           Tokens named with --tokens are taken out too, as they are: they are not sold.
 *           Stop the server first, or it will go on trading.
 *
 * The treasury owns the wallets and operates them. Only the owner can take anything out.
 */
import "./dns-fallback.mjs";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, formatUnits, getAddress, http, isAddress, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";

const AGENTS = { QUANT: "The Researcher", DEGEN: "The Observer", GUARDIAN: "The Strategist", ORACLE: "The Executor" };
/** Uniswap v4's pool manager on Robinhood Chain. */
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const what = process.argv[2];
const envFile = arg("--env") ?? ".env.local";

if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set");
const mainnet = process.env.ROBINHOOD_NETWORK === "mainnet";
if (!mainnet) throw new Error("The pools the wallets swap in are on mainnet. Run this with the mainnet env file.");
const chain = mainnet ? robinhood : robinhoodTestnet;
const usdg = getAddress(process.env.USDG_ADDRESS || "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const start = Number(process.env.NEXT_PUBLIC_START_CASH) >= 10 ? Math.floor(Number(process.env.NEXT_PUBLIC_START_CASH)) : 20;
const cap = Math.round(start * 0.25);

const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 25_000 });
const pub = createPublicClient({ chain, transport });
const signer = createWalletClient({ account, chain, transport });
const artifact = JSON.parse(readFileSync(new URL("../contracts/AgentWallet.json", import.meta.url), "utf8"));
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)", "function transfer(address to, uint256 amount) returns (bool)"]);

const written = () => Object.fromEntries([...(existsSync(envFile) ? readFileSync(envFile, "utf8") : "").matchAll(/^(WALLET_[A-Z]+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
const note = (k, v, comment) => appendFileSync(envFile, `${comment ? `\n# ${comment}\n` : ""}${k}=${v}\n`);
const walletOf = (name) => process.env[`WALLET_${name}`] || written()[`WALLET_${name}`];
const decimals = await pub.readContract({ address: usdg, abi: erc20, functionName: "decimals" });
const usd = (units) => formatUnits(units, decimals);
const holds = (token, owner) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [owner] });

/** Runs a transaction against the chain without sending it, then sends it and waits. The treasury's other transactions can take its place, so it is tried again. */
async function sent(label, request) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { request: ready } = await pub.simulateContract({ account, ...request });
      const receipt = await pub.waitForTransactionReceipt({ hash: await signer.writeContract(ready), timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${label} failed on-chain`);
      console.log(`  ${label}: ${receipt.transactionHash}`);
      return receipt;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  ${label}: ${e.shortMessage ?? e.message}. Trying again.`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

async function status() {
  console.log(`Treasury ${account.address} on ${chain.name}: ${usd(await holds(usdg, account.address))} USDG, ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
  for (const [name, agent] of Object.entries(AGENTS)) {
    const w = walletOf(name);
    console.log(w ? `${agent}'s wallet ${w}: ${usd(await holds(usdg, getAddress(w)))} USDG` : `${agent} has no wallet yet`);
  }
}

if (what === "deploy") {
  const need = parseUnits(String(start), decimals);
  const missing = Object.keys(AGENTS).filter((n) => !written()[`WALLET_${n}`]).length;
  const has = await holds(usdg, account.address);
  console.log(`Each agent starts with ${start} USDG, and a purchase is capped at ${cap}. The treasury holds ${usd(has)} USDG.`);
  let first = true;
  for (const [name, agent] of Object.entries(AGENTS)) {
    let address = written()[`WALLET_${name}`];
    if (!address) {
      const receipt = await pub.waitForTransactionReceipt({ hash: await signer.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: [agent, POOL_MANAGER, account.address] }), timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`deploying ${agent}'s wallet failed`);
      address = receipt.contractAddress;
      note(`WALLET_${name}`, address, first && missing === 4 ? "The agents' wallets, deployed by scripts/wallets.mjs: each holds its agent's USDG and the tokens it buys, and swaps in the tokens' pools." : null);
      console.log(`Deployed ${agent}'s wallet at ${address}.`);
    }
    first = false;
    const wallet = getAddress(address);
    if ((await pub.readContract({ address: wallet, abi: artifact.abi, functionName: "maxSpend", args: [usdg] })) !== parseUnits(String(cap), decimals)) {
      await sent(`capping ${agent}'s purchases at ${cap} USDG`, { address: wallet, abi: artifact.abi, functionName: "setMaxSpend", args: [usdg, parseUnits(String(cap), decimals)] });
    }
    const held = await holds(usdg, wallet);
    if (held < need) {
      const short = need - held;
      if ((await holds(usdg, account.address)) < short) throw new Error(`The treasury has too little USDG to give ${agent} its ${usd(short)}. Send it more, and run this again.`);
      await sent(`giving ${agent} ${usd(short)} USDG`, { address: usdg, abi: erc20, functionName: "transfer", args: [wallet, short] });
    }
  }
  console.log(`\nThe settings are in ${envFile}. Set the same four on the host, then deploy the site.`);
} else if (what === "cash-out") {
  const to = arg("--to");
  if (to !== null && !isAddress(to ?? "", { strict: false })) throw new Error("--to must be a wallet address.");
  const dest = to ? getAddress(to) : account.address;
  const tokens = (arg("--tokens") ?? "").split(",").filter(Boolean).map((t) => getAddress(t));
  for (const [name, agent] of Object.entries(AGENTS)) {
    const w = walletOf(name);
    if (!w) continue;
    const wallet = getAddress(w);
    for (const currency of [usdg, ...tokens]) {
      const held = await holds(currency, wallet);
      if (held === 0n) continue;
      const symbol = currency === usdg ? "USDG" : await pub.readContract({ address: currency, abi: erc20, functionName: "symbol" }).catch(() => currency);
      await sent(`taking ${currency === usdg ? usd(held) : held} ${symbol} out of ${agent}'s wallet`, { address: wallet, abi: artifact.abi, functionName: "withdraw", args: [currency, dest, held] });
    }
  }
} else if (what !== "status") {
  throw new Error("Say what to do: deploy, status or cash-out.");
}
await status();
process.exit(0);
