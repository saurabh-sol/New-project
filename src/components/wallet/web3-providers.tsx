"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { connectorsForWallets, darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider, type Transport } from "wagmi";
import { walletConnect } from "wagmi/connectors";
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

// MetaMask is always offered. Every other installed wallet announces itself to the page
// and is picked up automatically, so none needs to be listed here.
const connectors = [
  ...connectorsForWallets([{ groupName: "Popular", wallets: [metaMaskWallet, injectedWallet] }], {
    appName: "The Council",
    projectId: WALLETCONNECT_ID ?? "browser-wallets-only",
  }),
  ...(WALLETCONNECT_ID ? [walletConnect({ projectId: WALLETCONNECT_ID, showQrModal: true, metadata: { name: "The Council", description: "AI trading desk", url: "https://localhost", icons: [] } })] : []),
];

const config = createConfig({
  chains: [CHAIN],
  connectors,
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
