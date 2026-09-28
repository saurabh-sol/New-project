/**
 * One-time Base testnet setup. Run after the treasury wallet has some Base Sepolia ETH:
 *
 *   node --env-file=.env.local scripts/setup-base.mjs
 *
 * Deploys a test token the treasury can mint (so the in-app faucet works), gives the
 * treasury a starting balance, and writes BASE_USDC_ADDRESS to .env.local.
 * Pass --env <file> to write the setting somewhere else.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const START_SUPPLY = 10_000n; // test tokens held by the treasury for bonuses and withdrawals
const MIN_ETH = parseEther("0.005");

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
if (process.env.BASE_NETWORK === "mainnet") throw new Error("This script is for the Base testnet only.");
if (!process.env.EVM_TREASURY_PRIVATE_KEY) throw new Error("EVM_TREASURY_PRIVATE_KEY is not set in .env.local");

const key = process.env.EVM_TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.BASE_RPC_URL || undefined);
const pub = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });

const eth = await pub.getBalance({ address: account.address });
console.log(`Treasury ${account.address} holds ${formatEther(eth)} ETH on Base Sepolia`);
if (eth < MIN_ETH) {
  console.log(`\nIt needs at least ${formatEther(MIN_ETH)} ETH to deploy the token and pay network fees.`);
  console.log("Get free Base Sepolia ETH from a faucet listed at https://docs.base.org/chain/network-faucets, then run this script again.");
  process.exit(1);
}

if (existsSync(envFile) && /^BASE_USDC_ADDRESS=.+/m.test(readFileSync(envFile, "utf8"))) {
  console.log(`BASE_USDC_ADDRESS is already set in ${envFile}. Nothing to do.`);
  process.exit(0);
}

const { abi, bytecode } = JSON.parse(readFileSync(new URL("../contracts/TestUSDC.json", import.meta.url), "utf8"));
const deployed = await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi, bytecode }) });
const token = deployed.contractAddress;
if (!token) throw new Error("The token was not deployed.");

const minted = await wallet.writeContract({ address: token, abi, functionName: "mint", args: [account.address, START_SUPPLY * 1_000_000n] });
await pub.waitForTransactionReceipt({ hash: minted });
appendFileSync(envFile, `\n# Base Sepolia test token deployed by scripts/setup-base.mjs. The treasury can mint it.\nBASE_USDC_ADDRESS=${token}\n`);

console.log(`Deployed test token at ${token} and gave the treasury ${START_SUPPLY} of it.`);
console.log("Restart the server to pick up the new setting.");
