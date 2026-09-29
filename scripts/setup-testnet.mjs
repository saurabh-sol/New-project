/**
 * One-time setup for Robinhood Chain testnet. Run after the treasury wallet has some testnet ETH:
 *
 *   node --env-file=.env.local scripts/setup-testnet.mjs
 *
 * Deploys a test USDG the treasury can mint (so the in-app faucet works), gives the
 * treasury a starting balance, and writes USDG_ADDRESS to .env.local.
 * Pass --env <file> to write the setting somewhere else.
 */
import "./dns-fallback.mjs";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhoodTestnet } from "viem/chains";

const START_SUPPLY = 10_000n; // test tokens held by the treasury for bonuses and withdrawals
const MIN_ETH = parseEther("0.002");

const envFile = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
if (process.env.ROBINHOOD_NETWORK === "mainnet") throw new Error("This script is for the testnet only. On mainnet the app uses the real USDG.");
if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set in .env.local");

const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4 });
const pub = createPublicClient({ chain: robinhoodTestnet, transport });
const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport });

const eth = await pub.getBalance({ address: account.address });
console.log(`Treasury ${account.address} holds ${formatEther(eth)} ETH on Robinhood Chain testnet`);
if (eth < MIN_ETH) {
  console.log(`\nIt needs at least ${formatEther(MIN_ETH)} ETH to deploy the token and pay network fees.`);
  console.log("Get free testnet ETH for the address above from one of these, then run this script again:");
  console.log("  https://www.alchemy.com/faucets/robinhood-testnet");
  console.log("  https://faucet.chainstack.com/robinhood-chain-testnet-faucet");
  console.log("  https://faucet.quicknode.com/robinhood/testnet");
  process.exit(1);
}

if (existsSync(envFile) && /^USDG_ADDRESS=.+/m.test(readFileSync(envFile, "utf8"))) {
  console.log(`USDG_ADDRESS is already set in ${envFile}. Nothing to do.`);
  process.exit(0);
}

const { abi, bytecode } = JSON.parse(readFileSync(new URL("../contracts/TestUSDG.json", import.meta.url), "utf8"));
const deployed = await pub.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi, bytecode }) });
const token = deployed.contractAddress;
if (!token) throw new Error("The token was not deployed.");

const minted = await wallet.writeContract({ address: token, abi, functionName: "mint", args: [account.address, START_SUPPLY * 1_000_000n] });
await pub.waitForTransactionReceipt({ hash: minted });
appendFileSync(envFile, `\n# Test USDG on Robinhood Chain testnet, deployed by scripts/setup-testnet.mjs. The treasury can mint it.\nUSDG_ADDRESS=${token}\n`);

console.log(`Deployed test USDG at ${token} and gave the treasury ${START_SUPPLY} of it.`);
console.log("Restart the server to pick up the new setting.");
