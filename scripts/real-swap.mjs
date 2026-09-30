/**
 * A first real trade on Robinhood Chain mainnet: deploys one agent's wallet, gives it a little
 * USDG, buys a token in its Uniswap v4 pool and sells it back. It says what the round trip cost.
 *
 *   node --env-file=.data/mainnet.env scripts/real-swap.mjs deploy            deploys the wallet, once
 *   node --env-file=.data/mainnet.env scripts/real-swap.mjs fund 1            sends it 1 USDG from the treasury
 *   node --env-file=.data/mainnet.env scripts/real-swap.mjs buy 1             buys 1 USDG of the token
 *   node --env-file=.data/mainnet.env scripts/real-swap.mjs sell              sells all of the token back
 *   node --env-file=.data/mainnet.env scripts/real-swap.mjs withdraw          returns the wallet's USDG to the treasury
 *   node --env-file=.data/mainnet.env scripts/real-swap.mjs status            reads only
 *
 * Every transaction is first run against the chain without being sent. If that fails, nothing is sent.
 * The token is VRAX, which is paired with USDG. --slippage 3 sets the most, in percent, that the
 * price may move between the dry run and the swap (3 if left out).
 */
import "./dns-fallback.mjs";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, formatUnits, getAddress, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood } from "viem/chains";

if (process.env.ROBINHOOD_NETWORK !== "mainnet") throw new Error("Run this with the mainnet env file.");
if (!process.env.TREASURY_PRIVATE_KEY) throw new Error("TREASURY_PRIVATE_KEY is not set");

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const TOKEN = { symbol: "VRAX", address: getAddress("0x94641b97010608c3827fb058074889f19868ff33") };
// VRAX's pool: USDG first, VRAX second, no pool fee, Pons's hook.
const KEY = { currency0: USDG, currency1: TOKEN.address, fee: 0, tickSpacing: 200, hooks: getAddress("0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044") };
/** The most one purchase may spend: $5. */
const CAP_USDG = "5";
const FILE = new URL("../.data/real-swap.json", import.meta.url);

const [what, amount] = process.argv.slice(2);
const slippage = process.argv.includes("--slippage") ? Number(process.argv[process.argv.indexOf("--slippage") + 1]) : 3;
const key = process.env.TREASURY_PRIVATE_KEY.trim();
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
const transport = http(process.env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, timeout: 25_000 });
const pub = createPublicClient({ chain: robinhood, transport });
const wallet = createWalletClient({ account, chain: robinhood, transport });
const artifact = JSON.parse(readFileSync(new URL("../contracts/AgentWallet.json", import.meta.url), "utf8"));
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function transfer(address to, uint256 amount) returns (bool)"]);

const saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const save = (more) => writeFileSync(FILE, `${JSON.stringify(Object.assign(saved, more), null, 2)}\n`);
const at = () => {
  if (!saved.wallet) throw new Error("No wallet yet. Run: deploy");
  return getAddress(saved.wallet);
};
const bal = (token, owner) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [owner] });
const tokenDecimals = await pub.readContract({ address: TOKEN.address, abi: erc20, functionName: "decimals" });
const usd = (units) => formatUnits(units, 6);
const tok = (units) => formatUnits(units, tokenDecimals);

async function mined(hash, note) {
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`${note} failed on-chain: ${hash}`);
  console.log(`  ${note}: ${hash} (fee ${formatEther(r.gasUsed * r.effectiveGasPrice)} ETH)`);
  return r;
}

async function status() {
  console.log(`treasury ${account.address}: ${usd(await bal(USDG, account.address))} USDG, ${formatEther(await pub.getBalance({ address: account.address }))} ETH`);
  if (!saved.wallet) return console.log("no agent wallet deployed yet");
  const w = at();
  console.log(`agent wallet ${w}: ${usd(await bal(USDG, w))} USDG, ${tok(await bal(TOKEN.address, w))} ${TOKEN.symbol}`);
  if (saved.trades?.length) for (const t of saved.trades) console.log(`  ${t.side} ${t.paid} -> ${t.got}  ${t.hash}`);
}

/** Swaps, after a dry run has said what comes back. `minOut` is that, less the slippage allowed. */
async function swap(zeroForOne, amountIn) {
  const args = (minOut) => [KEY, zeroForOne, amountIn, minOut];
  const dry = await pub.simulateContract({ account, address: at(), abi: artifact.abi, functionName: "swap", args: args(0n) });
  const [paid, got] = dry.result;
  const minOut = (got * BigInt(Math.round((100 - slippage) * 100))) / 10_000n;
  console.log(`  dry run: pays ${zeroForOne ? usd(paid) + " USDG" : tok(paid) + " " + TOKEN.symbol}, gets ${zeroForOne ? tok(got) + " " + TOKEN.symbol : usd(got) + " USDG"}. Sending, for no less than ${zeroForOne ? tok(minOut) : usd(minOut)}.`);
  const hash = await wallet.writeContract({ address: at(), abi: artifact.abi, functionName: "swap", args: args(minOut) });
  await mined(hash, zeroForOne ? `bought ${TOKEN.symbol}` : `sold ${TOKEN.symbol}`);
  return { hash, paid, got };
}

if (what === "deploy") {
  if (saved.wallet) throw new Error(`Already deployed at ${saved.wallet}`);
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args: ["Trial", POOL_MANAGER, account.address] });
  const r = await mined(hash, "deployed the agent wallet");
  save({ wallet: r.contractAddress, deployedAt: Number(r.blockNumber), trades: [] });
  console.log(`  at ${r.contractAddress}`);
  await mined(await wallet.writeContract({ address: r.contractAddress, abi: artifact.abi, functionName: "setMaxSpend", args: [USDG, parseUnits(CAP_USDG, 6)] }), `capped a purchase at ${CAP_USDG} USDG`);
} else if (what === "fund") {
  const units = parseUnits(amount ?? "1", 6);
  await pub.simulateContract({ account, address: USDG, abi: erc20, functionName: "transfer", args: [at(), units] });
  await mined(await wallet.writeContract({ address: USDG, abi: erc20, functionName: "transfer", args: [at(), units] }), `sent ${usd(units)} USDG to the agent wallet`);
} else if (what === "buy") {
  const units = parseUnits(amount ?? "1", 6);
  const before = await bal(USDG, at());
  const t = await swap(true, units);
  save({ trades: [...(saved.trades ?? []), { side: "BUY", paid: `${usd(t.paid)} USDG`, got: `${tok(t.got)} ${TOKEN.symbol}`, hash: t.hash, usdgBefore: usd(before) }] });
} else if (what === "sell") {
  const held = await bal(TOKEN.address, at());
  if (held === 0n) throw new Error(`The wallet holds no ${TOKEN.symbol}.`);
  const t = await swap(false, held);
  const bought = [...(saved.trades ?? [])].reverse().find((x) => x.side === "BUY");
  save({ trades: [...(saved.trades ?? []), { side: "SELL", paid: `${tok(t.paid)} ${TOKEN.symbol}`, got: `${usd(t.got)} USDG`, hash: t.hash }] });
  if (bought) {
    const spent = Number(bought.paid.split(" ")[0]);
    const back = Number(usd(t.got));
    console.log(`  the round trip: ${spent} USDG in, ${back} USDG back, ${(back - spent).toFixed(6)} USDG (${(((back - spent) / spent) * 100).toFixed(2)}%)`);
  }
} else if (what === "withdraw") {
  const units = await bal(USDG, at());
  if (units === 0n) throw new Error("The wallet holds no USDG.");
  await pub.simulateContract({ account, address: at(), abi: artifact.abi, functionName: "withdraw", args: [USDG, account.address, units] });
  await mined(await wallet.writeContract({ address: at(), abi: artifact.abi, functionName: "withdraw", args: [USDG, account.address, units] }), `returned ${usd(units)} USDG to the treasury`);
} else if (what !== "status") {
  throw new Error("Say what to do: deploy, fund <usdg>, buy <usdg>, sell, withdraw or status.");
}
await status();
process.exit(0);
