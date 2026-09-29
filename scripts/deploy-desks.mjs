/**
 * Deploys the agents' desk contracts: one for each agent, and the share book that issues
 * the receipts for their positions. Run once, after the funding token is set up:
 *
 *   node --env-file=.env.local scripts/deploy-desks.mjs
 *
 * The treasury is the operator of every contract. The script lets each contract draw USDG
 * from the treasury, and writes DESK_QUANT, DESK_DEGEN, DESK_GUARDIAN, DESK_ORACLE, DESK_SHARES
 * and DESK_FROM_BLOCK to .env.local. The agents' cash is put in by the server the first time
 * it runs with the contracts.
 *
 * It can be run again if it broke off: what is already written to the file is not deployed twice.
 * Pass --env <file> to write the settings somewhere else.
 */
import "./dns-fallback.mjs";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, formatUnits, getAddress, http, maxUint256, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";

const AGENTS = { QUANT: "The Quant", DEGEN: "The Degen", GUARDIAN: "The Guardian", ORACLE: "The Oracle" };
const MIN_ETH = parseEther("0.002");
const mainnet = process.env.ROBINHOOD_NETWORK === "mainnet";
const chain = mainnet ? robinhood : robinhoodTestnet;

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
if (mainnet && process.env.ALLOW_MAINNET_FUNDING !== "true") throw new Error("These contracts have not been audited. They deploy to mainnet only with ALLOW_MAINNET_FUNDING=true.");
if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set in .env.local");
const usdg = process.env.USDG_ADDRESS || (mainnet ? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" : null);
if (!usdg) throw new Error("USDG_ADDRESS is not set. Run scripts/setup-testnet.mjs first.");

/** What the file already holds, so that a second run carries on from the first. */
const written = () => Object.fromEntries([...(existsSync(envFile) ? readFileSync(envFile, "utf8") : "").matchAll(/^(DESK_[A-Z_]+)=(\S+)$/gm)].map((m) => [m[1], m[2]]));
const note = (key, value, comment) => appendFileSync(envFile, `${comment ? `\n# ${comment}\n` : ""}${key}=${value}\n`);

const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 20_000 });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)", "function allowance(address owner, address spender) view returns (uint256)"]);
const artifact = (name) => JSON.parse(readFileSync(new URL(`../contracts/${name}.json`, import.meta.url), "utf8"));

/** Sends a transaction and waits for it. The public endpoints lose one now and then, so it is tried again. */
async function sent(what, send) {
  for (let attempt = 1; ; attempt++) {
    try {
      const receipt = await pub.waitForTransactionReceipt({ hash: await send(), timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${what} failed on-chain`);
      return receipt;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  ${what}: ${e.shortMessage ?? e.message}. Trying again.`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

const eth = await pub.getBalance({ address: account.address });
console.log(`Treasury ${account.address} holds ${formatEther(eth)} ETH on ${chain.name}`);
if (eth < MIN_ETH) throw new Error(`It needs at least ${formatEther(MIN_ETH)} ETH to deploy the contracts.`);
const decimals = await pub.readContract({ address: getAddress(usdg), abi: erc20, functionName: "decimals" });
console.log(`and ${formatUnits(await pub.readContract({ address: getAddress(usdg), abi: erc20, functionName: "balanceOf", args: [account.address] }), decimals)} USDG`);

const book = artifact("CouncilShares");
const desk = artifact("AgentDesk");

let shares = written().DESK_SHARES;
if (!shares) {
  const deployed = await sent("the share book", () => wallet.deployContract({ abi: book.abi, bytecode: book.bytecode }));
  shares = deployed.contractAddress;
  note("DESK_SHARES", shares, "The agents' desk contracts, deployed by scripts/deploy-desks.mjs: the share book, then a desk for each agent.");
  note("DESK_FROM_BLOCK", deployed.blockNumber);
  console.log(`Deployed the share book at ${shares} (block ${deployed.blockNumber}).`);
}

for (const [name, agent] of Object.entries(AGENTS)) {
  let address = written()[`DESK_${name}`];
  if (!address) {
    const deployed = await sent(`${agent}'s desk`, () => wallet.deployContract({ abi: desk.abi, bytecode: desk.bytecode, args: [agent, getAddress(usdg), decimals, getAddress(shares), account.address, account.address] }));
    address = deployed.contractAddress;
    note(`DESK_${name}`, address);
    console.log(`Deployed ${agent}'s desk at ${address}.`);
  }
  // The desk may ask the share book for receipts.
  if (!(await pub.readContract({ address: getAddress(shares), abi: book.abi, functionName: "isDesk", args: [getAddress(address)] }))) {
    await sent(`registering ${agent}'s desk`, () => wallet.writeContract({ address: getAddress(shares), abi: book.abi, functionName: "setDesk", args: [getAddress(address), true] }));
  }
  // It draws the agent's capital, and the gains of its trades, from the treasury.
  if ((await pub.readContract({ address: getAddress(usdg), abi: erc20, functionName: "allowance", args: [account.address, getAddress(address)] })) < maxUint256 / 2n) {
    await sent(`letting ${agent}'s desk draw USDG`, () => wallet.writeContract({ address: getAddress(usdg), abi: erc20, functionName: "approve", args: [getAddress(address), maxUint256] }));
  }
}

console.log(`\nThe settings are in ${envFile}. Set the same six on the host, then restart the server.`);
process.exit(0);
