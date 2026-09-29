"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider, type Transport } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { robinhood, robinhoodTestnet } from "wagmi/chains";

const network = process.env.NEXT_PUBLIC_ROBINHOOD_NETWORK === "mainnet" ? robinhood : robinhoodTestnet;
const rpcUrl = process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL;

/**
 * Robinhood Chain, or its testnet. Must match ROBINHOOD_NETWORK on the server.
 * A wallet that has never seen the network is given these details when it is asked to switch to it.
 */
export const CHAIN = rpcUrl ? defineChain({ ...network, rpcUrls: { default: { http: [rpcUrl] } } }) : network;

// Robinhood Wallet is a phone app. It connects by QR code through WalletConnect, which needs a free project ID.
export const WALLETCONNECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || null;
export const WALLETCONNECT = "walletConnect";

/** The connector for a wallet that is in the browser but doesn't announce itself, as older wallets don't. */
export const UNNAMED = "injected";

// Installed wallets announce themselves to the page, MetaMask included, and each becomes a
// connector named after the wallet. None is listed here: a connector listed under a wallet's
// name would take the place of the installed wallet itself.
const connectors = [
  injected(),
  ...(WALLETCONNECT_ID ? [walletConnect({ projectId: WALLETCONNECT_ID, showQrModal: true, metadata: { name: "The Council", description: "AI trading desk", url: "https://localhost", icons: [] } })] : []),
];

const config = createConfig({
  chains: [CHAIN],
  connectors,
  multiInjectedProviderDiscovery: true,
  transports: { [CHAIN.id]: http(rpcUrl || undefined) } as Record<typeof CHAIN.id, Transport>,
  ssr: true,
});

// Black and white, to match the rest of the site.
const theme = darkTheme({ accentColor: "#ffffff", accentColorForeground: "#000000", borderRadius: "large", overlayBlur: "small" });

/** RainbowKit and what it depends on, for Ethereum-type wallets on Robinhood Chain. */
export function Web3Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" initialChain={CHAIN}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
