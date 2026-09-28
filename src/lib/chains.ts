/** The chains a wallet can be on. Shared by server and browser. */

export type ChainId = "solana" | "base";

/** A Solana address is base58; an Ethereum-type address is 0x followed by 40 hex digits. */
export const chainOfAddress = (address: string): ChainId => (/^0x[0-9a-fA-F]{40}$/.test(address) ? "base" : "solana");

/** What the browser must do to make a deposit, which differs by chain. */
export type PreparedDeposit =
  /** Solana: a transfer the server built and co-signed. The wallet signs it and hands it back. */
  | { kind: "solana"; transaction: string; cluster: "devnet" | "mainnet-beta" }
  /** Base: the wallet sends a token transfer itself and reports the transaction hash. */
  | { kind: "base"; chainId: number; token: `0x${string}`; to: `0x${string}`; units: string };

/** What the browser hands back as evidence of the deposit. */
export type DepositProof = { kind: "solana"; transaction: string } | { kind: "base"; hash: `0x${string}` };

export interface ChainStatus {
  id: ChainId;
  /** For people: "Solana devnet", "Base Sepolia". */
  network: string;
  testnet: boolean;
  tokenSymbol: string;
  enabled: boolean;
  /** Why funding is off on this chain, when it is. */
  reason: string | null;
  /** Why the treasury can't send payments on this chain, or null if it can. Rewards only need this. */
  payoutReason: string | null;
  faucet: boolean;
  faucetAmount: number;
  /** Link to a transaction on a block explorer; "{id}" is replaced by the signature or hash. */
  explorerTx: string;
}

export const explorerLink = (chain: Pick<ChainStatus, "explorerTx">, id: string) => chain.explorerTx.replace("{id}", id);
