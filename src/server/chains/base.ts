import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, isAddress, keccak256, parseAbi, parseEther, parseEventLogs, type Chain as ViemChain, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base as baseMainnet, baseSepolia } from "viem/chains";
import type { ChainStatus } from "@/lib/chains";
import { hasDb } from "../db";
import { problemCache, queue } from "./shared";
import type { Chain, Fate, SignedPayment } from "./types";

const DECIMALS = 6;
/** Circle's USDC. Used unless BASE_USDC_ADDRESS names another token, such as the test token. */
const USDC: Record<"sepolia" | "mainnet", Hex> = {
  sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};
const MIN_TREASURY_ETH = parseEther("0.002");
/** Enough for a few token transfers on Base. Given with faucet tokens so a new wallet can make its first deposit. */
const GAS_GIFT = parseEther("0.0003");
const GAS_GIFT_BELOW = parseEther("0.0001");
const GAS_GIFT_NEEDS = parseEther("0.01");
/** A payment with no trace after this long was never sent. */
const LOST_AFTER_MS = 10 * 60_000;

const abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address owner) view returns (uint256)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const units = (usd: number) => BigInt(Math.round(usd * 10 ** DECIMALS));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function base(): Chain {
  const env = process.env;
  const network = env.BASE_NETWORK === "mainnet" ? "mainnet" : "sepolia";
  const testnet = network === "sepolia";
  const chain: ViemChain = testnet ? baseSepolia : baseMainnet;
  const transport = http(env.BASE_RPC_URL || undefined);
  const pub = createPublicClient({ chain, transport });
  const token: Hex = env.BASE_USDC_ADDRESS && isAddress(env.BASE_USDC_ADDRESS) ? getAddress(env.BASE_USDC_ADDRESS) : USDC[network];

  let account: PrivateKeyAccount | null = null;
  let keyError: string | null = null;
  if (env.EVM_TREASURY_PRIVATE_KEY) {
    try {
      const raw = env.EVM_TREASURY_PRIVATE_KEY.trim();
      account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
    } catch {
      keyError = "EVM_TREASURY_PRIVATE_KEY is set but is not a valid private key.";
    }
  }

  const treasuryProblem = keyError ?? (!account ? "No Base treasury is configured. Set EVM_TREASURY_PRIVATE_KEY." : null);
  const fundingProblem = !hasDb()
    ? "Funding needs a database. Set DATABASE_URL."
    : // Taking real deposits is a custody business with legal duties. It stays off on mainnet unless switched on deliberately.
      !testnet && env.ALLOW_MAINNET_FUNDING !== "true"
      ? "Funding is switched off on Base mainnet."
      : null;

  const treasury = (): PrivateKeyAccount => {
    if (!account) throw new Error("No Base treasury is configured");
    return account;
  };
  const wallet = () => createWalletClient({ account: treasury(), chain, transport });

  const tokenBalance = async (owner: Hex) => Number(await pub.readContract({ address: token, abi, functionName: "balanceOf", args: [owner] })) / 10 ** DECIMALS;

  /** Whether the treasury can actually pay: the token must exist and the treasury needs ETH for fees. */
  async function runtimeProblem(): Promise<string | null> {
    if (treasuryProblem) return treasuryProblem;
    try {
      if (!(await pub.getCode({ address: token }))) return "The funding token is not deployed on Base yet.";
      if ((await pub.getBalance({ address: treasury().address })) < MIN_TREASURY_ETH) return "The Base treasury has no ETH to pay network fees yet.";
      return null;
    } catch {
      return "Can't reach the Base network right now.";
    }
  }

  async function canMint(): Promise<boolean> {
    try {
      return same(await pub.readContract({ address: token, abi, functionName: "owner" }), treasury().address);
    } catch {
      return false;
    }
  }

  /** Signs a call to the token contract without sending it. Must run inside `withTreasury`, which keeps nonces in order. */
  async function sign(data: Hex, after?: () => Promise<void>): Promise<SignedPayment> {
    const nonce = await pub.getTransactionCount({ address: treasury().address, blockTag: "pending" });
    const client = wallet();
    const request = await client.prepareTransactionRequest({ to: token, data, nonce });
    const raw = await client.signTransaction(request);
    const id = keccak256(raw);
    return {
      id,
      expiry: nonce,
      async send() {
        await pub.sendRawTransaction({ serializedTransaction: raw });
        const receipt = await pub.waitForTransactionReceipt({ hash: id, timeout: 90_000 });
        if (receipt.status !== "success") throw new Error("Transfer failed on-chain");
        await after?.();
      },
    };
  }

  /** A little ETH for gas, so a wallet with none can still make its first deposit. Best effort. */
  async function giftGas(to: Hex) {
    try {
      if ((await pub.getBalance({ address: to })) >= GAS_GIFT_BELOW) return;
      if ((await pub.getBalance({ address: treasury().address })) < GAS_GIFT_NEEDS) return;
      const hash = await wallet().sendTransaction({ to, value: GAS_GIFT });
      await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch (e) {
      console.error("[base] could not send gas with the faucet:", e instanceof Error ? e.message : e);
    }
  }

  const receiptOf = (hash: Hex) => pub.getTransactionReceipt({ hash }).catch(() => null);
  const key = `base:${network}:${env.BASE_RPC_URL ?? ""}:${token}`;

  return {
    id: "base",

    async status(): Promise<ChainStatus> {
      const payoutReason = await problemCache(key, runtimeProblem);
      const reason = payoutReason ?? fundingProblem;
      const faucet = reason === null && testnet && env.FAUCET_ENABLED === "true" && (await problemCache(`${key}:mint`, async () => ((await canMint()) ? null : "no"))) === null;
      return {
        id: "base",
        network: testnet ? "Base Sepolia" : "Base",
        testnet,
        tokenSymbol: env.TOKEN_SYMBOL || (testnet ? "test USDC" : "USDC"),
        enabled: reason === null,
        reason,
        payoutReason,
        faucet,
        faucetAmount: Number(env.FAUCET_AMOUNT) > 0 ? Number(env.FAUCET_AMOUNT) : 100,
        explorerTx: `https://${testnet ? "sepolia." : ""}basescan.org/tx/{id}`,
      };
    },

    normalize(address) {
      return typeof address === "string" && isAddress(address, { strict: false }) ? getAddress(address) : null;
    },

    /** `signature` is hex. Goes through the network so smart-contract wallets verify too. */
    async verify(address, message, signature) {
      try {
        return await pub.verifyMessage({ address: address as Hex, message, signature: signature as Hex });
      } catch {
        return false;
      }
    },

    async hasHistory(address, min) {
      if (min <= 0) return true;
      return (await pub.getTransactionCount({ address: address as Hex })) >= min;
    },

    balance: (address) => tokenBalance(address as Hex).catch(() => 0),
    treasuryBalance: () => tokenBalance(treasury().address).catch(() => 0),
    withTreasury: (work) => queue(`treasury:base:${network}`, work),

    signPayment: (to, usd) => sign(encodeFunctionData({ abi, functionName: "transfer", args: [to as Hex, units(usd)] })),
    signFaucet: (to, usd) => sign(encodeFunctionData({ abi, functionName: "mint", args: [to as Hex, units(usd)] }), () => giftGas(to as Hex)),

    async fate(id, expiry, ageMs): Promise<Fate> {
      const hash = id as Hex;
      const settled = async (): Promise<Fate | null> => {
        const receipt = await receiptOf(hash);
        return receipt ? (receipt.status === "success" ? "landed" : "dead") : null;
      };
      const first = await settled();
      if (first) return first;

      // Another transaction has used this payment's place in the queue, so this one can never be mined.
      const used = await pub.getTransactionCount({ address: treasury().address, blockTag: "latest" });
      if (used > expiry) return (await settled()) ?? "dead";

      if (ageMs > LOST_AFTER_MS && !(await pub.getTransaction({ hash }).catch(() => null))) return "dead";
      return "unknown";
    },

    /** The wallet sends the transfer itself, so nothing is signed here. `check` records the exact amount expected. */
    async prepareDeposit(_wallet, usd) {
      const amount = units(usd).toString();
      return { payload: { kind: "base", chainId: chain.id, token, to: treasury().address, units: amount }, check: amount };
    },

    async settleDeposit(intent, proof) {
      if (proof.kind !== "base") return { ok: false, error: "This deposit was prepared for a Base wallet." };
      if (!/^0x[0-9a-fA-F]{64}$/.test(proof.hash)) return { ok: false, error: "That is not a transaction hash." };

      let receipt;
      try {
        receipt = await pub.waitForTransactionReceipt({ hash: proof.hash, timeout: 90_000 });
      } catch {
        return { ok: false, error: "The transfer was not confirmed yet. Try again in a minute: the deposit will be credited." };
      }
      if (receipt.status !== "success") return { ok: false, error: "The transfer failed on-chain. Nothing was moved." };
      if (!same(receipt.from, intent.wallet)) return { ok: false, error: "That transfer was sent by a different wallet." };

      const paid = parseEventLogs({ abi, eventName: "Transfer", logs: receipt.logs }).some(
        (log) => same(log.address, token) && same(log.args.from, intent.wallet) && same(log.args.to, treasury().address) && log.args.value.toString() === intent.check,
      );
      if (!paid) return { ok: false, error: "That transaction is not the transfer this deposit asked for." };

      // A transfer made before the request existed can't be the one it asked for.
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      if (Number(block.timestamp) * 1000 < intent.createdAt - 120_000) return { ok: false, error: "That transfer is older than this deposit request." };

      return { ok: true, id: proof.hash };
    },
  };
}
