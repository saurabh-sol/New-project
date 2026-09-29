"use client";

import { AnimatePresence } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react";
import { erc20Abi } from "viem";
import { useAccount, useConnect, useDisconnect, useSignMessage, useSwitchChain, useWriteContract, type Connector } from "wagmi";
import type { ChainId, DepositProof, PreparedDeposit } from "@/lib/chains";
import { ConnectWindow, type WalletOption } from "./connect-window";
import { CHAIN, UNNAMED, WALLETCONNECT } from "./web3-providers";

interface WalletContext {
  /** "robinhood" once a wallet is connected, null before. */
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

export function useWallet(): WalletContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

/** MetaMask names itself io.metamask, and its developer build io.metamask.flask. */
const isMetaMask = (c: Connector) => c.id.startsWith("io.metamask");
const INSTALL = { MetaMask: "https://metamask.io/download", "Robinhood Wallet": "https://robinhood.com/us/en/web3-wallet/" };

/** A wallet that announced itself to the page, as opposed to a built-in fallback connector. */
const announced = (c: Connector) => c.type === "injected" && c.id.includes(".");

/** Whether the browser has a wallet at all, announced or not. */
const hasProvider = () => typeof window !== "undefined" && !!(window as { ethereum?: unknown }).ethereum;
const never = () => () => {};
const cancelled = (e: unknown) => /reject|denied|cancel|declin/i.test(e instanceof Error ? e.message : String(e));

/** The connected wallet on Robinhood Chain, and the window for choosing one. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [showing, setShowing] = useState(false);
  const provider = useSyncExternalStore(never, hasProvider, () => false);

  const account = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const connect = useCallback(
    async (connector: Connector) => {
      await connectAsync({ connector });
      // Connecting only needs the address. The move to Robinhood Chain is asked for now, and again before a deposit if it didn't happen.
      if ((await connector.getChainId().catch(() => CHAIN.id)) !== CHAIN.id) void switchChainAsync({ connector, chainId: CHAIN.id }).catch(() => {});
    },
    [connectAsync, switchChainAsync],
  );

  // MetaMask and Robinhood Wallet are always offered. Every other installed wallet is listed under them.
  const { popular, installed } = useMemo(() => {
    const metamask = connectors.find(isMetaMask);
    const phone = connectors.find((c) => c.id === WALLETCONNECT);
    const popular: WalletOption[] = [
      { key: "metamask", name: "MetaMask", note: "Browser extension", icon: metamask?.icon ?? "/wallets/metamask.svg", connect: metamask ? () => connect(metamask) : undefined, installUrl: INSTALL.MetaMask },
      {
        key: "robinhood",
        name: "Robinhood Wallet",
        note: phone ? "Phone app, by QR code" : "Phone app",
        icon: null,
        connect: phone ? () => connect(phone) : undefined,
        installUrl: INSTALL["Robinhood Wallet"],
        installLabel: "Get",
      },
    ];
    const installed = connectors
      .filter((c) => announced(c) && !isMetaMask(c))
      .map((c): WalletOption => ({ key: c.id, name: c.name, note: "Installed", icon: c.icon ?? null, connect: () => connect(c) }));
    // A wallet that is in the browser but announced nothing can still be reached, without its name.
    const unnamed = connectors.find((c) => c.id === UNNAMED);
    if (provider && unnamed && !metamask && installed.length === 0) {
      installed.push({ key: UNNAMED, name: "Browser wallet", note: "Installed", icon: null, connect: () => connect(unnamed) });
    }
    return { popular, installed };
  }, [connectors, connect, provider]);

  const disconnect = useCallback(async () => {
    await disconnectAsync().catch(() => {});
  }, [disconnectAsync]);

  const open = useCallback(() => setShowing(true), []);
  const close = useCallback(() => setShowing(false), []);

  const signMessage = useCallback(
    async (text: string) => {
      if (!account.isConnected) throw new Error("Connect a wallet first.");
      return signMessageAsync({ message: text });
    },
    [account.isConnected, signMessageAsync],
  );

  const deposit = useCallback(
    async (prepared: PreparedDeposit): Promise<DepositProof> => {
      const connector = account.connector;
      if (!account.isConnected || !connector) throw new Error("Connect a wallet first.");

      // Ask the wallet itself which network it is on. What the app remembers can be out of date.
      if ((await connector.getChainId()) !== prepared.chainId) {
        try {
          // A wallet that has never seen Robinhood Chain is given its details and asked to add it.
          await switchChainAsync({ connector, chainId: prepared.chainId });
        } catch (e) {
          if (cancelled(e)) throw e;
          throw new Error(`Switch your wallet to ${CHAIN.name} and try again.`);
        }
        if ((await connector.getChainId()) !== prepared.chainId) throw new Error(`Your wallet is still on another network. Switch it to ${CHAIN.name} and try again.`);
      }

      try {
        const hash = await writeContractAsync({
          connector,
          chainId: prepared.chainId,
          address: prepared.token,
          abi: erc20Abi,
          functionName: "transfer",
          args: [prepared.to, BigInt(prepared.units)],
        });
        return { kind: "robinhood", hash };
      } catch (e) {
        // Wallet libraries report failures as a page of technical detail. Keep the first line.
        const text = e instanceof Error ? e.message : String(e);
        if (/insufficient funds|exceeds the balance/i.test(text)) throw new Error(`Your wallet has no ${CHAIN.nativeCurrency.symbol} on ${CHAIN.name} to pay the network fee.`);
        throw new Error(text.split("\n")[0]);
      }
    },
    [account.isConnected, account.connector, switchChainAsync, writeContractAsync],
  );

  const value = useMemo<WalletContext>(() => {
    const shared = { open, disconnect, signMessage, deposit };
    if (!account.isConnected || !account.address) return { ...shared, chain: null, address: null, walletName: null, icon: null };
    return { ...shared, chain: "robinhood", address: account.address, walletName: account.connector?.name ?? "Wallet", icon: account.connector?.icon ?? null };
  }, [account.isConnected, account.address, account.connector, open, disconnect, signMessage, deposit]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>{showing && <ConnectWindow popular={popular} installed={installed} onClose={close} />}</AnimatePresence>
    </Ctx.Provider>
  );
}
