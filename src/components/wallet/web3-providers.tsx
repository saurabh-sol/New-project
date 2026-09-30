"use client";

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth";
import { useMemo } from "react";
import { defineChain } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { BRAND } from "@/lib/brand";
import { useTheme } from "@/lib/theme";

const network = process.env.NEXT_PUBLIC_ROBINHOOD_NETWORK === "mainnet" ? robinhood : robinhoodTestnet;
const rpcUrl = process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL;

/**
 * Robinhood Chain, or its testnet. Must match ROBINHOOD_NETWORK on the server.
 * A wallet that has never seen the network is given these details when it is asked to switch to it.
 */
export const CHAIN = rpcUrl ? defineChain({ ...network, rpcUrls: { default: { http: [rpcUrl] } } }) : network;

/** This app's ID at Privy, which runs the window where a wallet is connected. It is public, and without it no wallet can connect. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || null;

// Black and white, to match the rest of the site.
const LOOK = {
  dark: { theme: "#000000", accentColor: "#ffffff" },
  light: { theme: "#ffffff", accentColor: "#000000" },
} as const;

// MetaMask first, then Robinhood Wallet, then every other wallet installed in the browser.
// Phone wallets connect by QR code through WalletConnect, which Privy provides.
const WALLETS: NonNullable<PrivyClientConfig["appearance"]>["walletList"] = ["metamask", "robinhood_wallet", "detected_ethereum_wallets", "wallet_connect_qr"];

/** Privy, for Ethereum-type wallets on Robinhood Chain. */
export function Web3Providers({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const config = useMemo<PrivyClientConfig>(
    () => ({
      // The app's own wallets only: no email, no social accounts, no wallet made by Privy.
      loginMethods: ["wallet"],
      embeddedWallets: { ethereum: { createOnLogin: "off" }, solana: { createOnLogin: "off" } },
      // A wallet on another network is asked to move to Robinhood Chain as it connects.
      defaultChain: CHAIN,
      supportedChains: [CHAIN],
      appearance: { ...LOOK[theme], walletChainType: "ethereum-only", walletList: WALLETS, showWalletLoginFirst: true, landingHeader: "Connect a wallet", loginMessage: `${BRAND} runs on ${CHAIN.name}.` },
    }),
    [theme],
  );

  if (!PRIVY_APP_ID) return children;
  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={config}>
      {children}
    </PrivyProvider>
  );
}
