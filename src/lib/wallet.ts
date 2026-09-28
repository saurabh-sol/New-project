"use client";

/**
 * Wallet connection through the Wallet Standard, which Phantom, Solflare, Backpack
 * and most other Solana wallets register themselves with.
 */
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { useSyncExternalStore } from "react";

export type { Wallet, WalletAccount };

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }>;
}
interface DisconnectFeature {
  disconnect(): Promise<void>;
}
interface SignMessageFeature {
  signMessage(
    ...inputs: { account: WalletAccount; message: Uint8Array }[]
  ): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>;
}

interface SignTransactionFeature {
  signTransaction(
    ...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]
  ): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

const CONNECT = "standard:connect";
const SIGN_TRANSACTION = "solana:signTransaction";
const DISCONNECT = "standard:disconnect";
const SIGN_MESSAGE = "solana:signMessage";

const isSolana = (chain: string) => chain.startsWith("solana:");
const usable = (w: Wallet) => w.chains.some(isSolana) && CONNECT in w.features && SIGN_MESSAGE in w.features;

const NONE: readonly Wallet[] = [];
let detected: readonly Wallet[] = NONE;

function subscribe(onChange: () => void) {
  const api = getWallets();
  const refresh = () => {
    detected = api.get().filter(usable);
    onChange();
  };
  const off = [api.on("register", refresh), api.on("unregister", refresh)];
  refresh();
  return () => off.forEach((f) => f());
}

/** Solana wallets installed in this browser. */
export const useSolanaWallets = () =>
  useSyncExternalStore(
    subscribe,
    () => detected,
    () => NONE,
  );

/** `silent` reconnects a wallet the user already approved, without opening it. */
export async function connectWallet(wallet: Wallet, silent = false): Promise<WalletAccount> {
  const { accounts } = await (wallet.features[CONNECT] as ConnectFeature).connect(silent ? { silent: true } : undefined);
  const all = accounts.length ? accounts : wallet.accounts;
  const account = all.find((a) => a.chains.some(isSolana)) ?? all[0];
  if (!account) throw new Error("The wallet didn't share an account.");
  return account;
}

export async function disconnectWallet(wallet: Wallet) {
  await (wallet.features[DISCONNECT] as DisconnectFeature | undefined)?.disconnect().catch(() => {});
}

/** Asks the wallet to sign a text message. Returns the signature as base64. */
export async function signMessage(wallet: Wallet, account: WalletAccount, message: string): Promise<string> {
  const [out] = await (wallet.features[SIGN_MESSAGE] as SignMessageFeature).signMessage({
    account,
    message: new TextEncoder().encode(message),
  });
  if (!out) throw new Error("The wallet returned no signature.");
  return toBase64(out.signature);
}

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
};

export const canSignTransactions = (wallet: Wallet) => SIGN_TRANSACTION in wallet.features;

/** Asks the wallet to sign a transaction the server prepared. Both sides are base64. The wallet does not send it. */
export async function signTransaction(wallet: Wallet, account: WalletAccount, transaction: string, cluster: "devnet" | "mainnet-beta"): Promise<string> {
  const feature = wallet.features[SIGN_TRANSACTION] as SignTransactionFeature | undefined;
  if (!feature) throw new Error(`${wallet.name} can't sign transactions for this app.`);
  const chain = cluster === "devnet" ? "solana:devnet" : "solana:mainnet";
  const [out] = await feature.signTransaction({ account, transaction: fromBase64(transaction), chain });
  if (!out) throw new Error("The wallet returned no signed transaction.");
  return toBase64(out.signedTransaction);
}

export const shortAddress = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
