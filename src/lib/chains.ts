/** The network the app pays and takes deposits on. Shared by server and browser. */

export type ChainId = "solana";

/** What the browser must do to make a deposit: sign a transfer the server built and co-signed, and hand it back. */
export interface PreparedDeposit {
  kind: "solana";
  transaction: string;
  cluster: "devnet" | "mainnet-beta";
}

/** What the browser hands back as evidence of the deposit. */
export interface DepositProof {
  kind: "solana";
  transaction: string;
}

export interface ChainStatus {
  id: ChainId;
  /** For people: "Solana devnet". */
  network: string;
  testnet: boolean;
  tokenSymbol: string;
  enabled: boolean;
  /** Why funding is off, when it is. */
  reason: string | null;
  /** Why the treasury can't send payments, or null if it can. Rewards only need this. */
  payoutReason: string | null;
  faucet: boolean;
  faucetAmount: number;
  /** Link to a transaction on a block explorer; "{id}" is replaced by the signature. */
  explorerTx: string;
}

export const explorerLink = (chain: Pick<ChainStatus, "explorerTx">, id: string) => chain.explorerTx.replace("{id}", id);
