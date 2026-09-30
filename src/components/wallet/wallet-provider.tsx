"use client";

import { useLogin, useLogout, usePrivy, useWallets, type EIP1193Provider } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, erc20Abi } from "viem";
import type { ChainId, DepositProof, PreparedDeposit } from "@/lib/chains";
import { CHAIN, PRIVY_APP_ID } from "./web3-providers";

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

const cancelled = (e: unknown) => /reject|denied|cancel|declin/i.test(e instanceof Error ? e.message : String(e));
const NOT_CONNECTED = "Connect a wallet first.";

/** The network the wallet itself says it is on. What the app remembers can be out of date. */
const chainOf = async (provider: EIP1193Provider) => Number(await provider.request({ method: "eth_chainId" }));

/** The connected wallet on Robinhood Chain. Privy shows the window for choosing one, and signs the wallet in. */
function PrivyWallet({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { wallets, ready: walletsReady } = useWallets();

  // The wallet that signed in. One that is only connected, or an account switched to since, is not taken for it.
  const wallet = useMemo(() => (ready && authenticated && walletsReady ? (wallets.find((w) => w.linked) ?? null) : null), [ready, authenticated, walletsReady, wallets]);

  // A press of Connect is kept until it can be answered: Privy may still be loading when it comes.
  const asked = useRef(false);
  const answer = useCallback(() => {
    if (!asked.current || !ready || !walletsReady) return;
    if (wallet) asked.current = false;
    // Signed in, but the wallet has gone (locked, or moved to another account): sign out first. Being signed out brings this back.
    else if (authenticated) void logout();
    else {
      asked.current = false;
      login();
    }
  }, [ready, walletsReady, wallet, authenticated, login, logout]);
  useEffect(answer, [answer]);

  const open = useCallback(() => {
    asked.current = true;
    answer();
  }, [answer]);

  const disconnect = useCallback(async () => {
    try {
      // Some wallets can't be disconnected by a website, and ignore this.
      wallet?.disconnect();
    } catch {}
    await logout().catch(() => {});
  }, [wallet, logout]);

  const signMessage = useCallback(
    async (text: string) => {
      if (!wallet) throw new Error(NOT_CONNECTED);
      return wallet.sign(text);
    },
    [wallet],
  );

  const deposit = useCallback(
    async (prepared: PreparedDeposit): Promise<DepositProof> => {
      if (!wallet) throw new Error(NOT_CONNECTED);

      if ((await chainOf(await wallet.getEthereumProvider())) !== prepared.chainId) {
        try {
          // A wallet that has never seen Robinhood Chain is given its details and asked to add it.
          await wallet.switchChain(prepared.chainId);
        } catch (e) {
          if (cancelled(e)) throw e;
          throw new Error(`Switch your wallet to ${CHAIN.name} and try again.`);
        }
        if ((await chainOf(await wallet.getEthereumProvider())) !== prepared.chainId) throw new Error(`Your wallet is still on another network. Switch it to ${CHAIN.name} and try again.`);
      }

      try {
        const client = createWalletClient({ account: wallet.address as `0x${string}`, chain: CHAIN, transport: custom(await wallet.getEthereumProvider()) });
        const hash = await client.writeContract({ address: prepared.token, abi: erc20Abi, functionName: "transfer", args: [prepared.to, BigInt(prepared.units)] });
        return { kind: "robinhood", hash };
      } catch (e) {
        // Wallet libraries report failures as a page of technical detail. Keep the first line.
        const text = e instanceof Error ? e.message : String(e);
        if (/insufficient funds|exceeds the balance/i.test(text)) throw new Error(`Your wallet has no ${CHAIN.nativeCurrency.symbol} on ${CHAIN.name} to pay the network fee.`);
        throw new Error(text.split("\n")[0]);
      }
    },
    [wallet],
  );

  const value = useMemo<WalletContext>(() => {
    const shared = { open, disconnect, signMessage, deposit };
    if (!wallet) return { ...shared, chain: null, address: null, walletName: null, icon: null };
    return { ...shared, chain: "robinhood", address: wallet.address, walletName: wallet.meta.name || "Wallet", icon: typeof wallet.meta.icon === "string" ? wallet.meta.icon : null };
  }, [wallet, open, disconnect, signMessage, deposit]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Stands in when the site has no Privy app ID: no wallet can connect, and pressing Connect says why. */
function NoWallet({ children }: { children: React.ReactNode }) {
  const [told, setTold] = useState(false);

  useEffect(() => {
    if (!told) return;
    const hide = setTimeout(() => setTold(false), 5000);
    return () => clearTimeout(hide);
  }, [told]);

  const value = useMemo<WalletContext>(() => {
    const refuse = async () => {
      throw new Error(NOT_CONNECTED);
    };
    return { chain: null, address: null, walletName: null, icon: null, open: () => setTold(true), disconnect: async () => {}, signMessage: refuse, deposit: refuse };
  }, []);

  return (
    <Ctx.Provider value={value}>
      {children}
      {told && (
        <div role="alert" className="panel panel-strong fixed bottom-4 left-1/2 z-[5000] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 px-4 py-3 text-sm text-white">
          Wallets can&apos;t connect yet: this site has no Privy app ID.
        </div>
      )}
    </Ctx.Provider>
  );
}

/** The connected wallet, for every page. */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  return PRIVY_APP_ID ? <PrivyWallet>{children}</PrivyWallet> : <NoWallet>{children}</NoWallet>;
}
