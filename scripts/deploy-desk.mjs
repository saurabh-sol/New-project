/**
 * Deploys the agents' desk contract. Run once, after the funding token is set up:
 *
 *   node --env-file=.env.local scripts/deploy-desk.mjs
 *
 * Deploys CouncilDesk with the treasury as its operator, lets it draw USDG from the
 * treasury, and writes DESK_ADDRESS to .env.local. The agents' cash is put in by the
 * server the first time it runs with the contract.
 * Pass --env <file> to write the settings somewhere else.
 */
import "./dns-fallback.mjs";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, formatUnits, getAddress, http, maxUint256, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, robinhoodTestnet } from "viem/chains";

const MIN_ETH = parseEther("0.001");
const mainnet = process.env.ROBINHOOD_NETWORK === "mainnet";
const chain = mainnet ? robinhood : robinhoodTestnet;

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
if (mainnet && process.env.ALLOW_MAINNET_FUNDING !== "true") throw new Error("This contract has not been audited. It deploys to mainnet only with ALLOW_MAINNET_FUNDING=true.");
if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set in .env.local");
const usdg = process.env.USDG_ADDRESS || (mainnet ? "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" : null);
if (!usdg) throw new Error("USDG_ADDRESS is not set. Run scripts/setup-testnet.mjs first.");
if (existsSync(envFile) && /^DESK_ADDRESS=.+/m.test(readFileSync(envFile, "utf8"))) {
  console.log(`DESK_ADDRESS is already set in ${envFile}. Nothing to do.`);
  process.exit(0);
}

const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 20_000 });
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const erc20 = parseAbi(["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)", "function approve(address spender, uint256 amount) returns (bool)"]);

const eth = await pub.getBalance({ address: account.address });
console.log(`Treasury ${account.address} holds ${formatEther(eth)} ETH on ${chain.name}`);
if (eth < MIN_ETH) throw new Error(`It needs at least ${formatEther(MIN_ETH)} ETH to deploy the contract.`);
const decimals = await pub.readContract({ address: getAddress(usdg), abi: erc20, functionName: "decimals" });
console.log(`and ${formatUnits(await pub.readContract({ address: getAddress(usdg), abi: erc20, functionName: "balanceOf", args: [account.address] }), decimals)} USDG`);

const { abi, bytecode } = JSON.parse(readFileSync(new URL("../contracts/CouncilDesk.json", import.meta.url), "utf8"));
const deployed = await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi, bytecode, args: [getAddress(usdg), decimals, account.address, account.address] }) });
const desk = deployed.contractAddress;
if (!desk) throw new Error("The contract was not deployed.");

// The desk draws the agents' capital, and the gains of their trades, from the treasury.
await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: getAddress(usdg), abi: erc20, functionName: "approve", args: [desk, maxUint256] }) });
appendFileSync(envFile, `\n# The agents' desk contract, deployed by scripts/deploy-desk.mjs.\nDESK_ADDRESS=${desk}\nDESK_FROM_BLOCK=${deployed.blockNumber}\n`);

console.log(`Deployed the desk at ${desk} (block ${deployed.blockNumber}).`);
console.log("Restart the server to pick up the new setting.");
