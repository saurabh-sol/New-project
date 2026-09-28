import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction, type Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createHash, createPublicKey, verify } from "node:crypto";
import type { ChainStatus } from "@/lib/chains";
import { hasDb } from "../db";
import { rewardsConfig, USDC_DECIMALS } from "../rewards/config";
import { problemCache, queue } from "./shared";
import type { Chain, Fate, SignedPayment } from "./types";

const MIN_TREASURY_SOL = 0.01;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const units = (usd: number) => BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function solana(): Chain {
  const env = process.env;
  const cfg = rewardsConfig();
  const devnet = cfg.cluster === "devnet";
  const conn = new Connection(cfg.rpcUrl, "confirmed");

  const treasuryProblem = cfg.treasuryError ?? (!cfg.treasury ? "No Solana treasury is configured. Set TREASURY_SECRET_KEY." : null);
  const fundingProblem = !hasDb()
    ? "Funding needs a database. Set DATABASE_URL."
    : // Taking real deposits is a custody business with legal duties. It stays off on mainnet unless switched on deliberately.
      !devnet && env.ALLOW_MAINNET_FUNDING !== "true"
      ? "Funding is switched off on Solana mainnet."
      : null;

  const treasury = (): Keypair => {
    if (!cfg.treasury) throw new Error("No Solana treasury is configured");
    return cfg.treasury;
  };
  const tokenAccount = (owner: PublicKey) => getAssociatedTokenAddressSync(cfg.mint, owner);

  async function tokenBalance(owner: PublicKey): Promise<number> {
    try {
      return (await conn.getTokenAccountBalance(tokenAccount(owner))).value.uiAmount ?? 0;
    } catch {
      return 0;
    }
  }

  /** Whether the treasury can actually pay: it needs SOL for fees and a token account. */
  async function runtimeProblem(): Promise<string | null> {
    if (treasuryProblem) return treasuryProblem;
    try {
      const sol = (await conn.getBalance(treasury().publicKey)) / 1e9;
      if (sol < MIN_TREASURY_SOL) return "The Solana treasury has no SOL to pay network fees yet.";
      if (!(await conn.getAccountInfo(tokenAccount(treasury().publicKey)))) return "The Solana treasury holds none of the funding token yet.";
      return null;
    } catch {
      return "Can't reach the Solana network right now.";
    }
  }

  async function canMint(): Promise<boolean> {
    try {
      return !!(await getMint(conn, cfg.mint)).mintAuthority?.equals(treasury().publicKey);
    } catch {
      return false;
    }
  }

  /** Signs a transaction the treasury pays for, without sending it. */
  async function sign(build: (tx: Transaction) => void): Promise<SignedPayment> {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: treasury().publicKey, blockhash, lastValidBlockHeight });
    build(tx);
    tx.sign(treasury());
    const id = bs58.encode(tx.signature!);
    return {
      id,
      expiry: lastValidBlockHeight,
      async send() {
        await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
        const result = await conn.confirmTransaction({ signature: id, blockhash, lastValidBlockHeight }, "confirmed");
        if (result.value.err) throw new Error(`Transfer failed on-chain: ${JSON.stringify(result.value.err)}`);
      },
    };
  }

  async function confirmed(id: string): Promise<boolean | "failed"> {
    const status = (await conn.getSignatureStatus(id, { searchTransactionHistory: true })).value;
    if (status?.err) return "failed";
    return status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized";
  }

  const key = `solana:${cfg.rpcUrl}:${cfg.mint.toBase58()}`;

  return {
    id: "solana",

    async status(): Promise<ChainStatus> {
      const payoutReason = await problemCache(key, runtimeProblem);
      const reason = payoutReason ?? fundingProblem;
      const faucet = reason === null && devnet && env.FAUCET_ENABLED === "true" && (await problemCache(`${key}:mint`, async () => ((await canMint()) ? null : "no"))) === null;
      return {
        id: "solana",
        network: devnet ? "Solana devnet" : "Solana",
        testnet: devnet,
        tokenSymbol: env.TOKEN_SYMBOL || (devnet ? "test USDC" : "USDC"),
        enabled: reason === null,
        reason,
        payoutReason,
        faucet,
        faucetAmount: Number(env.FAUCET_AMOUNT) > 0 ? Number(env.FAUCET_AMOUNT) : 100,
        explorerTx: `https://solscan.io/tx/{id}${devnet ? "?cluster=devnet" : ""}`,
      };
    },

    normalize(address) {
      if (typeof address !== "string" || address.length < 32 || address.length > 44) return null;
      try {
        const k = new PublicKey(address);
        return PublicKey.isOnCurve(k.toBytes()) ? k.toBase58() : null;
      } catch {
        return null;
      }
    },

    /** `signature` is base64. */
    async verify(address, message, signature) {
      try {
        const sig = Buffer.from(signature, "base64");
        if (sig.length !== 64) return false;
        const spki = Buffer.concat([ED25519_SPKI_PREFIX, new PublicKey(address).toBytes()]);
        return verify(null, Buffer.from(message, "utf8"), createPublicKey({ key: spki, format: "der", type: "spki" }), sig);
      } catch {
        return false;
      }
    },

    async hasHistory(address, min) {
      if (min <= 0) return true;
      return (await conn.getSignaturesForAddress(new PublicKey(address), { limit: min })).length >= min;
    },

    balance: (address) => tokenBalance(new PublicKey(address)),
    treasuryBalance: () => tokenBalance(treasury().publicKey),
    withTreasury: (work) => queue("treasury:solana", work),

    signPayment(to, usd) {
      const dest = new PublicKey(to);
      return sign((tx) =>
        tx.add(
          // The treasury also pays the rent for the recipient's token account, if they have never held the token.
          createAssociatedTokenAccountIdempotentInstruction(treasury().publicKey, tokenAccount(dest), dest, cfg.mint),
          createTransferCheckedInstruction(tokenAccount(treasury().publicKey), cfg.mint, tokenAccount(dest), treasury().publicKey, units(usd), USDC_DECIMALS),
        ),
      );
    },

    signFaucet(to, usd) {
      const dest = new PublicKey(to);
      return sign((tx) =>
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(treasury().publicKey, tokenAccount(dest), dest, cfg.mint),
          createMintToCheckedInstruction(cfg.mint, tokenAccount(dest), treasury().publicKey, units(usd), USDC_DECIMALS),
        ),
      );
    },

    async fate(id, expiry): Promise<Fate> {
      const state = await confirmed(id);
      if (state === "failed") return "dead";
      if (state) return "landed";
      // Past its last valid block, a transaction that hasn't landed never will.
      return (await conn.getBlockHeight("confirmed")) > expiry ? "dead" : "unknown";
    },

    /** The treasury pays the network fee, so the user needs no SOL. The user only signs the transfer. */
    async prepareDeposit(wallet, usd) {
      const from = new PublicKey(wallet);
      const to = tokenAccount(treasury().publicKey);
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const tx = new Transaction({ feePayer: treasury().publicKey, blockhash, lastValidBlockHeight }).add(
        createAssociatedTokenAccountIdempotentInstruction(treasury().publicKey, to, treasury().publicKey, cfg.mint),
        createTransferCheckedInstruction(tokenAccount(from), cfg.mint, to, from, units(usd), USDC_DECIMALS),
      );
      tx.partialSign(treasury());
      return {
        payload: { kind: "solana", cluster: cfg.cluster, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") },
        check: createHash("sha256").update(tx.serializeMessage()).digest("hex"),
      };
    },

    async settleDeposit(intent, proof) {
      if (proof.kind !== "solana") return { ok: false, error: "This deposit was prepared for a Solana wallet." };
      let tx: Transaction;
      try {
        tx = Transaction.from(Buffer.from(proof.transaction, "base64"));
      } catch {
        return { ok: false, error: "The signed transaction could not be read." };
      }
      // The treasury signed exactly one message for this request. Anything else fails one of these checks.
      const hash = createHash("sha256").update(tx.serializeMessage()).digest("hex");
      if (hash !== intent.check || !tx.verifySignatures()) return { ok: false, error: "The signed transaction does not match this deposit request." };
      const id = bs58.encode(tx.signature!);

      if ((await confirmed(id)) !== true) {
        try {
          await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
        } catch (e) {
          // Sent before (a retry of this call). Whether it landed is settled below.
          if (!/already (been )?processed/i.test(String(e))) {
            console.error("[solana] deposit was not accepted:", e);
            return { ok: false, error: "The network rejected the transfer. Nothing was moved." };
          }
        }
        const until = Date.now() + 60_000;
        let state: boolean | "failed" = false;
        while (Date.now() < until && !(state = await confirmed(id))) await sleep(1000);
        if (state !== true) return { ok: false, error: "The transfer was not confirmed. If funds left your wallet, try again in a minute: the deposit will be credited." };
      }
      return { ok: true, id };
    },
  };
}
