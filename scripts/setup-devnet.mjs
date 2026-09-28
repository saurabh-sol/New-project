/**
 * One-time devnet setup. Run after the treasury wallet has some devnet SOL:
 *
 *   node --env-file=.env.local scripts/setup-devnet.mjs
 *
 * Creates a test token the treasury can mint (so the in-app faucet works), gives the
 * treasury a starting balance, and writes USDC_MINT to .env.local.
 */
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { appendFileSync, readFileSync } from "node:fs";

const START_SUPPLY = 10_000; // test tokens held by the treasury for bonuses and withdrawals
const MIN_SOL = 0.05;

if (process.env.SOLANA_CLUSTER === "mainnet-beta") throw new Error("This script is for devnet only.");
if (!process.env.TREASURY_SECRET_KEY) throw new Error("TREASURY_SECRET_KEY is not set in .env.local");

const treasury = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.TREASURY_SECRET_KEY)));
const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const address = treasury.publicKey.toBase58();

const sol = (await conn.getBalance(treasury.publicKey)) / LAMPORTS_PER_SOL;
console.log(`Treasury ${address} holds ${sol} SOL`);
if (sol < MIN_SOL) {
  console.log(`\nIt needs at least ${MIN_SOL} SOL to pay network fees.`);
  console.log(`Get free devnet SOL at https://faucet.solana.com for the address above, then run this script again.`);
  process.exit(1);
}

if (/^USDC_MINT=.+/m.test(readFileSync(".env.local", "utf8"))) {
  console.log("USDC_MINT is already set in .env.local. Nothing to do.");
  process.exit(0);
}

const mint = await createMint(conn, treasury, treasury.publicKey, null, 6);
const account = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
await mintTo(conn, treasury, mint, account.address, treasury, BigInt(START_SUPPLY) * 1_000_000n);
appendFileSync(".env.local", `\n# Devnet test token created by scripts/setup-devnet.mjs. The treasury can mint it.\nUSDC_MINT=${mint.toBase58()}\n`);

console.log(`Created test token ${mint.toBase58()} and gave the treasury ${START_SUPPLY} of it.`);
console.log("Restart the server to pick up the new setting.");
