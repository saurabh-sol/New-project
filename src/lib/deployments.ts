/** Where the desk's contracts are deployed on Robinhood Chain. Public addresses, shared by server and browser. */
import { CHAIN_IDS, type Network } from "./chains";
import type { AgentId } from "./types";

export interface Deployment {
  network: Network;
  /** For people: "Robinhood Chain Testnet". */
  name: string;
  chainId: number;
  rpc: string;
  explorer: string;
  /** Each agent's desk contract. */
  desks: Record<AgentId, string>;
  /** The share book, which issues the receipts for the agents' positions. */
  shares: string;
  /** The wallet that owns and operates the desks, and takes the other side of every trade. */
  treasury: string;
  /** The funding token. */
  usdg: string;
  usdgSymbol: string;
}

/**
 * The contracts as they were deployed. The server puts its own settings over these for the
 * network it runs on, so the pages follow a desk that was replaced.
 */
export const DEPLOYED: Record<Network, Deployment> = {
  testnet: {
    network: "testnet",
    name: "Robinhood Chain Testnet",
    chainId: CHAIN_IDS.testnet,
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    desks: {
      quant: "0x38b8F564aa603707580E091fa6F5B89aD11B6Bc8",
      degen: "0x17c17353F7e2424A8560772B93c3D943c36f001E",
      guardian: "0x7fb674E69a48a8320B42c5D9c2Ea0Bb486F70bcb",
      oracle: "0xF26D49310d513266F03967Ace14B305154947348",
    },
    shares: "0xF8F674cAA3fED59528Cf38Ac7b294a8959ffdCe9",
    treasury: "0xf7D07942E1F8633F54F9200CB3b54d05EE60dca2",
    usdg: "0xd656dd44e8F0270174a204d70b62A450950B1188",
    usdgSymbol: "test USDG",
  },
  mainnet: {
    network: "mainnet",
    name: "Robinhood Chain",
    chainId: CHAIN_IDS.mainnet,
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    desks: {
      quant: "0xf543786e6F5793904245414aebC427C7eC090387",
      degen: "0xf8a28d9EA736a2DfD4e425B17CfDE845859b1675",
      guardian: "0x5e9afd96D88D98B8efcA96B57A5816854b1F61d9",
      oracle: "0xC25D7C5980819a4dA5286e75d9Cd7393012862Ae",
    },
    shares: "0x57E2Fd4848709Acc6f43935cff028d0a4Bc50102",
    treasury: "0x883b885C8F70b733B1C134FF621B033697bAf1DF",
    usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    usdgSymbol: "USDG",
  },
};

export const addressLink = (d: Pick<Deployment, "explorer">, address: string) => `${d.explorer}/address/${address}`;
