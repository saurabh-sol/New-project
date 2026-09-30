/** How the market modules reach Robinhood Chain's mainnet, which prices come from. */
import { fallback, http } from "viem";

/**
 * The endpoint set in ROBINHOOD_MAINNET_RPC_URL is asked first. A provider may refuse to search
 * the chain's record over more than a few blocks at once, which the chain's public endpoint
 * does, so that one stands behind it.
 */
export function mainnetTransport(timeout: number) {
  const url = process.env.ROBINHOOD_MAINNET_RPC_URL;
  if (!url) return http(undefined, { retryCount: 2, timeout });
  return fallback([http(url, { timeout }), http(undefined, { timeout })], { retryCount: 2 });
}
