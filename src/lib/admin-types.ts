/** What the admin's display is told about the things the desk runs on. */
export interface AdminStatus {
  user: string;
  serverTime: number;
  /** When this server last started. */
  startedAt: number;
  /** The commit the server was built from, if the host says. */
  version: string | null;
  network: string;
  database: boolean;
  gateway: { hasKey: boolean; outOfBudget: boolean };
  sessions: {
    /** Sessions run on AI models today, and the most that may be. */
    today: number;
    perDay: number;
    lastAt: number | null;
    lastRiskCheck: number | null;
  };
  /** The wallet that pays for gas and takes the other side of every trade. Null if none is configured. */
  treasury: { address: string; explorerAddress: string; gas: number | null; usdg: number | null } | null;
}
