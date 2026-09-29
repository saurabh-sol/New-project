/** The network the app pays and takes deposits on: Robinhood Chain. Shared by server and browser. */

export type ChainId = "robinhood";

export type Network = "mainnet" | "testnet";

/** Chain ids of Robinhood Chain and its testnet. */
export const CHAIN_IDS: Record<Network, number> = { mainnet: 4663, testnet: 46630 };

/** What the browser must do to make a deposit: send a token transfer from the wallet, and report its hash. */
export interface PreparedDeposit {
  kind: "robinhood";
  chainId: number;
  token: `0x${string}`;
  to: `0x${string}`;
  /** The amount in the token's smallest unit. */
  units: string;
}

/** What the browser hands back as evidence of the deposit. */
export interface DepositProof {
  kind: "robinhood";
  hash: `0x${string}`;
}

export interface ChainStatus {
  id: ChainId;
  /** For people: "Robinhood Chain Testnet". */
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
  /** Link to a transaction on the block explorer; "{id}" is replaced by the transaction hash. */
  explorerTx: string;
}

/** One agent's desk contract. */
export interface AgentDeskInfo {
  address: string;
  explorerAddress: string;
  /** USDG the contract holds. Null if the chain couldn't be read. */
  holds: number | null;
  /** Whether it holds at least what it owes the agent. */
  solvent: boolean | null;
}

/** The agents' desk contracts, as the pages show them. Each agent has one of its own. */
export interface DeskInfo {
  network: string;
  /** Link to a transaction; "{id}" is replaced by the transaction hash. */
  explorerTx: string;
  agents: Record<"quant" | "degen" | "guardian" | "oracle", AgentDeskInfo>;
  /** USDG the four contracts hold between them. Null if the chain couldn't be read. */
  holds: number | null;
  /** Whether every contract holds at least what it owes its agent. */
  solvent: boolean | null;
  /** When the contracts took over. Trades from before then are not on them. */
  since: number;
}

export const explorerLink = (chain: Pick<ChainStatus, "explorerTx">, id: string) => chain.explorerTx.replace("{id}", id);
