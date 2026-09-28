import { chainOfAddress, type ChainId } from "@/lib/chains";
import { base } from "./base";
import { solana } from "./solana";
import type { Chain } from "./types";

export type { Chain, DepositIntent, Fate, SignedPayment } from "./types";

export const CHAIN_IDS: ChainId[] = ["solana", "base"];

export const chainById = (id: ChainId): Chain => (id === "base" ? base() : solana());

export const allChains = (): Chain[] => CHAIN_IDS.map(chainById);

/** The chain an address belongs to, with the address in its standard form. Null if it is no wallet address at all. */
export function chainFor(address: unknown): { chain: Chain; address: string } | null {
  if (typeof address !== "string") return null;
  const chain = chainById(chainOfAddress(address.trim()));
  const normal = chain.normalize(address.trim());
  return normal ? { chain, address: normal } : null;
}
