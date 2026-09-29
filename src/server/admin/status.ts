import { erc20Abi, formatEther } from "viem";
import type { AdminStatus } from "@/lib/admin-types";
import { connection } from "../chains/robinhood";
import { councilConfig } from "../council/config";
import { outOfBudget } from "../council/round";
import { readState, today } from "../council/store";
import { hasDb } from "../db";

/** The treasury's balances change with every trade recorded, and are asked of the chain no more often than this. */
const TREASURY_QUIET_MS = 60_000;

const shared = globalThis as typeof globalThis & { __adminTreasury?: { at: number; value: AdminStatus["treasury"] }; __startedAt?: number };
const startedAt = (shared.__startedAt ??= Date.now());

async function treasury(): Promise<AdminStatus["treasury"]> {
  const kept = shared.__adminTreasury;
  if (kept && Date.now() - kept.at < TREASURY_QUIET_MS) return kept.value;
  const c = connection();
  if (!c.account) return null;
  const address = c.account.address;
  const { token } = c;
  const [gas, usdg] = await Promise.all([
    c.pub.getBalance({ address }).then((wei) => Number(formatEther(wei))).catch(() => null),
    token
      ? Promise.all([c.pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] }), c.pub.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })])
          // Whole cents, so a balance held to 18 places still reads exactly.
          .then(([raw, places]) => Number(raw / BigInt(10) ** BigInt(places - 2)) / 100)
          .catch(() => null)
      : null,
  ]);
  const value = { address, explorerAddress: `${c.explorer}/address/${address}`, gas, usdg };
  // A reading that failed is asked for again next time.
  if (gas !== null) shared.__adminTreasury = { at: Date.now(), value };
  return value;
}

/** What only the admin is shown: the state of the things the desk runs on. */
export async function adminStatus(user: string): Promise<AdminStatus> {
  const cfg = councilConfig();
  const [state, wallet] = await Promise.all([readState(), treasury().catch(() => null)]);
  const c = connection();
  return {
    user,
    serverTime: Date.now(),
    startedAt,
    version: (process.env.RENDER_GIT_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null,
    network: c.name,
    database: hasDb(),
    gateway: { hasKey: cfg.hasKey, outOfBudget: outOfBudget() },
    sessions: {
      today: state.day === today() ? state.roundsToday : 0,
      perDay: cfg.maxRoundsPerDay,
      lastAt: state.lastRoundAt || null,
      lastRiskCheck: state.lastRiskCheck || null,
    },
    treasury: wallet,
  };
}
