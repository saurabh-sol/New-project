import { robinhood } from "./robinhood";
import type { Chain } from "./types";

export type { Chain, DepositIntent, Fate, SignedPayment } from "./types";

/** The network the app runs on. */
export const chain = (): Chain => robinhood();

/** The address in its standard form, with the chain it is on. Null if it is not a wallet address. */
export function chainFor(address: unknown): { chain: Chain; address: string } | null {
  if (typeof address !== "string") return null;
  const normal = chain().normalize(address.trim());
  return normal ? { chain: chain(), address: normal } : null;
}
