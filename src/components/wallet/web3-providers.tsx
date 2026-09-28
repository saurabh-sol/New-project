"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { connectorsForWallets, darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createConfig, http, WagmiProvider, type Transport } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";

/** Must match BASE_NETWORK on the server. */
export const BASE_CHAIN = process.env.NEXT_PUBLIC_BASE_NETWORK === "mainnet" ? base : baseSepolia;

// WalletConnect (phone wallets and QR codes) needs a free project ID. Without one, browser wallets still work.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// MetaMask is the one wallet always offered. Every other installed wallet announces itself
// to the page and is picked up automatically, so none needs to be listed here.
const connectors = connectorsForWallets(
  [
    { groupName: "Popular", wallets: [metaMaskWallet, injectedWallet] },
    ...(projectId ? [{ groupName: "Phone wallets", wallets: [walletConnectWallet] }] : []),
  ],
  { appName: "The Council", projectId: projectId ?? "browser-wallets-only" },
);

const config = createConfig({
  chains: [BASE_CHAIN],
  connectors,
  transports: { [BASE_CHAIN.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined) } as Record<typeof BASE_CHAIN.id, Transport>,
  ssr: true,
});

// Black and white, to match the rest of the site.
const theme = darkTheme({ accentColor: "#ffffff", accentColorForeground: "#000000", borderRadius: "large", overlayBlur: "small" });

/** RainbowKit and what it depends on, for Ethereum-type wallets on Base. */
export function Web3Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" initialChain={BASE_CHAIN}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
