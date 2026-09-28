"use client";

import { useAccountModal } from "@rainbow-me/rainbowkit";
import { AnimatePresence } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi } from "viem";
import { useAccount, useAccountEffect, useConnect, useDisconnect, useSignMessage, useSwitchChain, useWriteContract, type Connector } from "wagmi";
import type { ChainId, DepositProof, PreparedDeposit } from "@/lib/chains";
import { ConnectWindow, useDefaultLogos, type WalletOption } from "./connect-window";
import { BASE_CHAIN } from "./web3-providers";
import { connectWallet, disconnectWallet, signMessage as signSolanaMessage, signTransaction, useSolanaWallets, type Wallet, type WalletAccount } from "@/lib/wallet";

interface WalletContext {
  /** Which kind of wallet is connected, or null if none is. */
  chain: ChainId | null;
  address: string | null;
  walletName: string | null;
  icon: string | null;
  connecting: boolean;
  /** Opens the window where the user picks a wallet. */
  open: () => void;
  /** Opens the connected wallet's details. */
  openAccount: () => void;
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

const METAMASK = "io.metamask";
const INSTALL = { MetaMask: "https://metamask.io/download", Phantom: "https://phantom.com/download" };

/** A wallet that announced itself to the page, as opposed to a built-in fallback connector. */
const announced = (c: Connector) => c.type === "injected" && c.id.includes(".");

const forget = () => {
  try {
    localStorage.removeItem(LAST_WALLET);
  } catch {}
};

/**
 * One wallet at a time, of either kind: an Ethereum-type wallet on Base through
 * RainbowKit, or a Solana wallet. Pages use this and never need to know which.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useSolanaWallets();
  const [solana, setSolana] = useState<{ wallet: Wallet; account: WalletAccount } | null>(null);
  const [showing, setShowing] = useState(false);
  const triedRestore = useRef(false);
  const logos = useDefaultLogos();

  const evm = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { openAccountModal } = useAccountModal();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  // Connecting an Ethereum-type wallet replaces a Solana one.
  useAccountEffect({
    onConnect() {
      setSolana((current) => {
        if (current) void disconnectWallet(current.wallet);
        return null;
      });
      forget();
    },
  });

  // Bring back the Solana wallet the user connected last time, without opening it.
  useEffect(() => {
    if (triedRestore.current || solana || evm.isConnected || evm.isReconnecting || wallets.length === 0) return;
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_WALLET);
    } catch {}
    const wallet = wallets.find((w) => w.name === last);
    if (!wallet) return;
    triedRestore.current = true;
    connectWallet(wallet, true)
      .then((account) => setSolana({ wallet, account }))
      .catch(() => {});
  }, [wallets, solana, evm.isConnected, evm.isReconnecting]);

  const connectSolana = useCallback(
    async (wallet: Wallet) => {
      const account = await connectWallet(wallet);
      if (evm.isConnected) await disconnectAsync().catch(() => {});
      setSolana({ wallet, account });
      try {
        localStorage.setItem(LAST_WALLET, wallet.name);
      } catch {}
    },
    [evm.isConnected, disconnectAsync],
  );

  const connectEvm = useCallback(
    async (connector: Connector) => {
      await connectAsync({ connector, chainId: BASE_CHAIN.id });
    },
    [connectAsync],
  );

  // MetaMask and Phantom are always offered. Every other installed wallet is listed under them.
  const { popular, installed } = useMemo(() => {
    const metamask = connectors.find((c) => c.id === METAMASK);
    const phantom = wallets.find((w) => w.name === "Phantom");
    const popular: WalletOption[] = [
      {
        key: "base:metamask",
        name: "MetaMask",
        network: "Base",
        icon: metamask?.icon ?? logos.MetaMask ?? null,
        connect: metamask ? () => connectEvm(metamask) : undefined,
        installUrl: INSTALL.MetaMask,
      },
      {
        key: "solana:phantom",
        name: "Phantom",
        network: "Solana",
        icon: phantom?.icon ?? logos.Phantom ?? null,
        connect: phantom ? () => connectSolana(phantom) : undefined,
        installUrl: INSTALL.Phantom,
      },
    ];
    const installed: WalletOption[] = [
      ...connectors
        .filter((c) => announced(c) && c.id !== METAMASK)
        .map((c): WalletOption => ({ key: `base:${c.id}`, name: c.name, network: "Base", icon: c.icon ?? null, connect: () => connectEvm(c) })),
      ...wallets
        .filter((w) => w.name !== "Phantom")
        .map((w): WalletOption => ({ key: `solana:${w.name}`, name: w.name, network: "Solana", icon: w.icon, connect: () => connectSolana(w) })),
    ];
    return { popular, installed };
  }, [connectors, wallets, logos, connectEvm, connectSolana]);

  const disconnect = useCallback(async () => {
    if (solana) await disconnectWallet(solana.wallet);
    if (evm.isConnected) await disconnectAsync().catch(() => {});
    setSolana(null);
    forget();
  }, [solana, evm.isConnected, disconnectAsync]);

  const open = useCallback(() => setShowing(true), []);
  const close = useCallback(() => setShowing(false), []);

  const signMessage = useCallback(
    async (text: string) => {
      if (solana) return signSolanaMessage(solana.wallet, solana.account, text);
      if (evm.isConnected) return signMessageAsync({ message: text });
      throw new Error("Connect a wallet first.");
    },
    [solana, evm.isConnected, signMessageAsync],
  );

  const deposit = useCallback(
    async (prepared: PreparedDeposit): Promise<DepositProof> => {
      if (prepared.kind === "solana") {
        if (!solana) throw new Error("Connect a Solana wallet first.");
        return { kind: "solana", transaction: await signTransaction(solana.wallet, solana.account, prepared.transaction, prepared.cluster) };
      }
      if (!evm.isConnected) throw new Error("Connect an Ethereum-type wallet first.");
      if (evm.chainId !== prepared.chainId) await switchChainAsync({ chainId: prepared.chainId });
      const hash = await writeContractAsync({
        chainId: prepared.chainId,
        address: prepared.token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [prepared.to, BigInt(prepared.units)],
      });
      return { kind: "base", hash };
    },
    [solana, evm.isConnected, evm.chainId, switchChainAsync, writeContractAsync],
  );

  const value = useMemo<WalletContext>(() => {
    // The picker shows its own progress, so the button stays usable: a wallet that never answers can't lock it.
    const shared = { connecting: false, open, openAccount: () => openAccountModal?.(), disconnect, signMessage, deposit };
    if (solana) return { ...shared, chain: "solana", address: solana.account.address, walletName: solana.wallet.name, icon: solana.wallet.icon };
    if (evm.isConnected && evm.address) {
      return { ...shared, chain: "base", address: evm.address, walletName: evm.connector?.name ?? "Wallet", icon: evm.connector?.icon ?? null };
    }
    return { ...shared, chain: null, address: null, walletName: null, icon: null };
  }, [solana, evm.isConnected, evm.address, evm.connector, open, openAccountModal, disconnect, signMessage, deposit]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>{showing && <ConnectWindow popular={popular} installed={installed} onClose={close} />}</AnimatePresence>
    </Ctx.Provider>
  );
}
