/** Robinhood Chain: an Ethereum layer 2. Payments are made in USDG, and network fees are paid in ETH. */
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, isAddress, keccak256, parseAbi, parseEther, parseEventLogs, type Chain as ViemChain, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { robinhood as mainnet, robinhoodTestnet } from "viem/chains";
import type { ChainStatus, Network } from "@/lib/chains";
import { hasDb } from "../db";
import { problemCache, queue } from "./shared";
import type { Chain, Fate, SignedPayment } from "./types";

/** USDG on Robinhood Chain. The testnet has no official one, so USDG_ADDRESS must name the test token there. */
const USDG: Hex = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const EXPLORER: Record<Network, string> = {
  mainnet: "https://robinhoodchain.blockscout.com",
  testnet: "https://explorer.testnet.chain.robinhood.com",
};

// Fees on Robinhood Chain are a small fraction of a cent, so these amounts go a long way.
const MIN_TREASURY_ETH = parseEther("0.001");
/** Enough for dozens of token transfers. Given with faucet tokens so a new wallet can make its first deposit. */
const GAS_GIFT = parseEther("0.0002");
const GAS_GIFT_BELOW = parseEther("0.00005");
const GAS_GIFT_NEEDS = parseEther("0.005");
/** A payment with no trace after this long was never sent. */
const LOST_AFTER_MS = 10 * 60_000;

const abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const TEN = BigInt(10);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// Asked of the chain once per token, then remembered.
const shared = globalThis as typeof globalThis & { __tokenDecimals?: Map<string, Promise<number>> };

export const networkOf = (env: NodeJS.ProcessEnv = process.env): Network => (env.ROBINHOOD_NETWORK === "mainnet" ? "mainnet" : "testnet");

const asAddress = (raw: string | undefined): Hex | null => (raw && isAddress(raw, { strict: false }) ? getAddress(raw) : null);

/** How the server reaches Robinhood Chain: the network, the treasury's key, and the contracts it uses. */
export function connection() {
  const env = process.env;
  const network = networkOf(env);
  const testnet = network === "testnet";
  const chain: ViemChain = testnet ? robinhoodTestnet : mainnet;
  // The public endpoints drop a request now and then, so each is tried more than once.
  const transport = http(env.ROBINHOOD_RPC_URL || undefined, { retryCount: 4, retryDelay: 400, timeout: 15_000 });

  let account: PrivateKeyAccount | null = null;
  let keyError: string | null = null;
  if (env.TREASURY_PRIVATE_KEY) {
    try {
      const raw = env.TREASURY_PRIVATE_KEY.trim();
      account = privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
    } catch {
      keyError = "TREASURY_PRIVATE_KEY is set but is not a valid private key.";
    }
  }

  return {
    network,
    testnet,
    chain,
    name: testnet ? "Robinhood Chain Testnet" : "Robinhood Chain",
    transport,
    pub: createPublicClient({ chain, transport }),
    account,
    keyError,
    /** The funding token. Null on the testnet until the setup script has deployed one. */
    token: asAddress(env.USDG_ADDRESS) ?? (testnet ? null : USDG),
    /** The agents' desk contract, if one is deployed. */
    desk: asAddress(env.DESK_ADDRESS),
    explorer: EXPLORER[network],
    /** Names the treasury's queue. Its payments leave one at a time, in order. */
    queue: `treasury:robinhood:${network}`,
  };
}

export function robinhood(): Chain {
  const env = process.env;
  const { network, testnet, chain, name, transport, pub, account, keyError, token, explorer, queue: treasuryQueue } = connection();

  const treasuryProblem =
    keyError ??
    (!account
      ? "No treasury is configured. Set TREASURY_PRIVATE_KEY."
      : !token
        ? "No funding token is set for the testnet. Run scripts/setup-testnet.mjs, which deploys a test USDG and sets USDG_ADDRESS."
        : null);
  const fundingProblem = !hasDb()
    ? "Funding needs a database. Set DATABASE_URL."
    : // Taking real deposits is a custody business with legal duties. It stays off on mainnet unless switched on deliberately.
      !testnet && env.ALLOW_MAINNET_FUNDING !== "true"
      ? "Funding is switched off on Robinhood Chain mainnet."
      : null;

  const treasury = (): PrivateKeyAccount => {
    if (!account) throw new Error("No treasury is configured");
    return account;
  };
  const usdg = (): Hex => {
    if (!token) throw new Error("No funding token is configured");
    return token;
  };
  const wallet = () => createWalletClient({ account: treasury(), chain, transport });

  function decimals(): Promise<number> {
    const known = (shared.__tokenDecimals ??= new Map());
    const key = `${chain.id}:${usdg()}`;
    let value = known.get(key);
    if (!value) {
      value = pub.readContract({ address: usdg(), abi, functionName: "decimals" }).then(Number);
      known.set(key, value);
      value.catch(() => known.delete(key));
    }
    return value;
  }
  const units = async (usd: number) => BigInt(Math.round(usd * 100)) * TEN ** BigInt((await decimals()) - 2);
  const tokenBalance = async (owner: Hex) => {
    const [raw, places] = await Promise.all([pub.readContract({ address: usdg(), abi, functionName: "balanceOf", args: [owner] }), decimals()]);
    // Whole cents, so a balance held to 18 places still reads exactly.
    return Number(raw / TEN ** BigInt(places - 2)) / 100;
  };

  /** Whether the treasury can actually pay: the token must exist and the treasury needs ETH for fees. */
  async function runtimeProblem(): Promise<string | null> {
    if (treasuryProblem) return treasuryProblem;
    try {
      if (!(await pub.getCode({ address: usdg() }))) return `The funding token is not deployed on ${name}.`;
      if ((await decimals()) < 2) return "The funding token has fewer than two decimals, which this app can't count in.";
      if ((await pub.getBalance({ address: treasury().address })) < MIN_TREASURY_ETH) return "The treasury has no ETH to pay network fees yet.";
      return null;
    } catch {
      return `Can't reach ${name} right now.`;
    }
  }

  async function canMint(): Promise<boolean> {
    try {
      return same(await pub.readContract({ address: usdg(), abi, functionName: "owner" }), treasury().address);
    } catch {
      return false;
    }
  }

  /** Signs a call to the token contract without sending it. Must run inside `withTreasury`, which keeps nonces in order. */
  async function sign(data: Hex, after?: () => Promise<void>): Promise<SignedPayment> {
    const nonce = await pub.getTransactionCount({ address: treasury().address, blockTag: "pending" });
    const client = wallet();
    const request = await client.prepareTransactionRequest({ to: usdg(), data, nonce });
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

  /** A little ETH for fees, so a wallet with none can still make its first deposit. Best effort. */
  async function giftGas(to: Hex) {
    try {
      if ((await pub.getBalance({ address: to })) >= GAS_GIFT_BELOW) return;
      if ((await pub.getBalance({ address: treasury().address })) < GAS_GIFT_NEEDS) return;
      const hash = await wallet().sendTransaction({ to, value: GAS_GIFT });
      await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    } catch (e) {
      console.error("[chain] could not send ETH for fees with the faucet:", e instanceof Error ? e.message : e);
    }
  }

  const receiptOf = (hash: Hex) => pub.getTransactionReceipt({ hash }).catch(() => null);
  const key = `robinhood:${network}:${env.ROBINHOOD_RPC_URL ?? ""}:${token}`;

  return {
    id: "robinhood",

    async status(): Promise<ChainStatus> {
      const payoutReason = await problemCache(key, runtimeProblem);
      const reason = payoutReason ?? fundingProblem;
      const faucet = reason === null && testnet && env.FAUCET_ENABLED === "true" && (await problemCache(`${key}:mint`, async () => ((await canMint()) ? null : "no"))) === null;
      return {
        id: "robinhood",
        network: name,
        testnet,
        tokenSymbol: env.TOKEN_SYMBOL || (testnet ? "test USDG" : "USDG"),
        enabled: reason === null,
        reason,
        payoutReason,
        faucet,
        faucetAmount: Number(env.FAUCET_AMOUNT) > 0 ? Number(env.FAUCET_AMOUNT) : 100,
        explorerTx: `${explorer}/tx/{id}`,
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
    withTreasury: (work) => queue(treasuryQueue, work),

    signPayment: async (to, usd) => sign(encodeFunctionData({ abi, functionName: "transfer", args: [to as Hex, await units(usd)] })),
    signFaucet: async (to, usd) => sign(encodeFunctionData({ abi, functionName: "mint", args: [to as Hex, await units(usd)] }), () => giftGas(to as Hex)),

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
      const amount = (await units(usd)).toString();
      return { payload: { kind: "robinhood", chainId: chain.id, token: usdg(), to: treasury().address, units: amount }, check: amount };
    },

    async settleDeposit(intent, proof) {
      if (proof.kind !== "robinhood" || !/^0x[0-9a-fA-F]{64}$/.test(proof.hash)) return { ok: false, error: "That is not a transaction hash." };

      let receipt;
      try {
        receipt = await pub.waitForTransactionReceipt({ hash: proof.hash, timeout: 90_000 });
      } catch {
        return { ok: false, error: "The transfer was not confirmed yet. Try again in a minute: the deposit will be credited." };
      }
      if (receipt.status !== "success") return { ok: false, error: "The transfer failed on-chain. Nothing was moved." };
      if (!same(receipt.from, intent.wallet)) return { ok: false, error: "That transfer was sent by a different wallet." };

      const paid = parseEventLogs({ abi, eventName: "Transfer", logs: receipt.logs }).some(
        (log) => same(log.address, usdg()) && same(log.args.from, intent.wallet) && same(log.args.to, treasury().address) && log.args.value.toString() === intent.check,
      );
      if (!paid) return { ok: false, error: "That transaction is not the transfer this deposit asked for." };

      // A transfer made before the request existed can't be the one it asked for.
      const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
      if (Number(block.timestamp) * 1000 < intent.createdAt - 120_000) return { ok: false, error: "That transfer is older than this deposit request." };

      return { ok: true, id: proof.hash };
    },
  };
}
