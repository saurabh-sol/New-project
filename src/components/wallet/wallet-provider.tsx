"use client";

import { AnimatePresence } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChainId, DepositProof, PreparedDeposit } from "@/lib/chains";
import { connectWallet, disconnectWallet, signMessage as signSolanaMessage, signTransaction, useSolanaWallets, type Wallet, type WalletAccount } from "@/lib/wallet";
import { ConnectWindow, type WalletOption } from "./connect-window";

interface WalletContext {
  /** "solana" once a wallet is connected, null before. */
  chain: ChainId | null;
  address: string | null;
  walletName: string | null;
  icon: string | null;
  /** Opens the window where the user picks a wallet. */
  open: () => void;
  disconnect: () => Promise<void>;
  /** Asks the wallet to sign a text message. Free, and sends nothing. */
  signMessage: (text: string) => Promise<string>;
  /** Carries out a deposit the server prepared, and returns the evidence of it. */
  deposit: (prepared: PreparedDeposit) => Promise<DepositProof>;
}

const Ctx = createContext<WalletContext | null>(null);
const LAST_WALLET = "council:wallet";

export function useWallet(): WalletContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

/** Always offered, installed or not. Every other installed wallet is listed under them. */
const POPULAR = [
  { name: "Phantom", logo: "/wallets/phantom.svg", installUrl: "https://phantom.com/download" },
  { name: "MetaMask", logo: "/wallets/metamask.svg", installUrl: "https://metamask.io/download" },
];

// MetaMask added Solana in 2025. An older copy is installed but has no Solana account to connect.
let oldMetaMask = false;

function watchMetaMask(onChange: () => void) {
  const heard = (e: Event) => {
    if ((e as CustomEvent<{ info?: { rdns?: string } }>).detail?.info?.rdns !== "io.metamask" || oldMetaMask) return;
    oldMetaMask = true;
    onChange();
  };
  window.addEventListener("eip6963:announceProvider", heard);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", heard);
}

const forget = () => {
  try {
    localStorage.removeItem(LAST_WALLET);
  } catch {}
};

/** The connected Solana wallet, and the window for choosing one. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useSolanaWallets();
  const [connected, setConnected] = useState<{ wallet: Wallet; account: WalletAccount } | null>(null);
  const [showing, setShowing] = useState(false);
  const triedRestore = useRef(false);
  const hasMetaMask = useSyncExternalStore(
    watchMetaMask,
    () => oldMetaMask,
    () => false,
  );

  // Bring back the wallet the user connected last time, without opening it.
  useEffect(() => {
    if (triedRestore.current || connected || wallets.length === 0) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET);
    } catch {}
    const wallet = wallets.find((w) => w.name === last);
    if (!wallet) return;
    triedRestore.current = true;
    connectWallet(wallet, true)
      .then((account) => setConnected({ wallet, account }))
      .catch(() => {});
  }, [wallets, connected]);

  const connect = useCallback(async (wallet: Wallet) => {
    const account = await connectWallet(wallet);
    setConnected({ wallet, account });
    try {
      localStorage.setItem(LAST_WALLET, wallet.name);
    } catch {}
  }, []);

  const { popular, installed } = useMemo(() => {
    const popular = POPULAR.map((p): WalletOption => {
      const wallet = wallets.find((w) => w.name === p.name);
      const option = { key: p.name, name: p.name, icon: wallet?.icon ?? p.logo, connect: wallet ? () => connect(wallet) : undefined, installUrl: p.installUrl };
      return p.name === "MetaMask" && !wallet && hasMetaMask ? { ...option, installLabel: "Update" } : option;
    });
    const installed = wallets
      .filter((w) => !POPULAR.some((p) => p.name === w.name))
      .map((w): WalletOption => ({ key: w.name, name: w.name, icon: w.icon, connect: () => connect(w) }));
    return { popular, installed };
  }, [wallets, connect, hasMetaMask]);

  const disconnect = useCallback(async () => {
    if (connected) await disconnectWallet(connected.wallet);
    setConnected(null);
    forget();
  }, [connected]);

  const open = useCallback(() => setShowing(true), []);
  const close = useCallback(() => setShowing(false), []);

  const signMessage = useCallback(
    async (text: string) => {
      if (!connected) throw new Error("Connect a wallet first.");
      return signSolanaMessage(connected.wallet, connected.account, text);
    },
    [connected],
  );

  const deposit = useCallback(
    async (prepared: PreparedDeposit): Promise<DepositProof> => {
      if (!connected) throw new Error("Connect a wallet first.");
      return { kind: "solana", transaction: await signTransaction(connected.wallet, connected.account, prepared.transaction, prepared.cluster) };
    },
    [connected],
  );

  const value = useMemo<WalletContext>(() => {
    const shared = { open, disconnect, signMessage, deposit };
    if (!connected) return { ...shared, chain: null, address: null, walletName: null, icon: null };
    return { ...shared, chain: "solana", address: connected.account.address, walletName: connected.wallet.name, icon: connected.wallet.icon };
  }, [connected, open, disconnect, signMessage, deposit]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>{showing && <ConnectWindow popular={popular} installed={installed} onClose={close} />}</AnimatePresence>
    </Ctx.Provider>
  );
}
