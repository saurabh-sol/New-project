import type { RewardsStatus } from "@/lib/rewards-types";
import { parseWallet } from "@/server/rewards/challenge";
import { rewardsConfig, rewardsMode } from "@/server/rewards/config";
import { publicClaim } from "@/server/rewards/http";
import { claimsToday, getClaim } from "@/server/rewards/ledger";
import { connect, settlePending, treasuryBalance } from "@/server/rewards/payout";

export async function GET(request: Request) {
  const cfg = rewardsConfig();
  const address = new URL(request.url).searchParams.get("wallet");
  const wallet = address ? parseWallet(address) : null;

  const status: RewardsStatus = {
    mode: rewardsMode(cfg),
    cluster: cfg.cluster,
    amount: cfg.amount,
    remainingToday: Math.max(0, cfg.dailyCap - (await claimsToday())),
    captchaSiteKey: cfg.turnstileSecret ? cfg.turnstileSiteKey : null,
    problem: cfg.treasuryError,
    claim: null,
  };

  if (cfg.treasury) {
    try {
      const conn = connect(cfg);
      if ((await treasuryBalance(conn, cfg, cfg.treasury)) < cfg.amount) status.problem = "The reward pool is empty right now. Check back later.";
      const claim = wallet ? await getClaim(wallet.toBase58()) : null;
      const settled = claim ? await settlePending(conn, claim) : null;
      status.claim = settled ? publicClaim(settled) : null;
    } catch {
      status.problem = "Can't reach the Solana network right now. Try again in a moment.";
    }
  }

  return Response.json(status);
}
