import type { RewardsStatus } from "@/lib/rewards-types";
import { chainById, chainFor } from "@/server/chains";
import { rewardsConfig } from "@/server/rewards/config";
import { publicClaim } from "@/server/rewards/http";
import { claimsToday, getClaim } from "@/server/rewards/ledger";
import { settlePending } from "@/server/rewards/payout";

export async function GET(request: Request) {
  const cfg = rewardsConfig();
  const found = chainFor(new URL(request.url).searchParams.get("wallet"));
  const chain = found?.chain ?? chainById("solana");
  const info = await chain.status();
  // Without a treasury the page still works as a demo. Any other problem is shown as it is.
  const noTreasury = !!info.payoutReason && /No .* treasury is configured/.test(info.payoutReason);

  const status: RewardsStatus = {
    mode: noTreasury ? "demo" : "live",
    chain: info,
    amount: cfg.amount,
    remainingToday: Math.max(0, cfg.dailyCap - (await claimsToday())),
    captchaSiteKey: cfg.turnstileSecret ? cfg.turnstileSiteKey : null,
    problem: noTreasury ? null : info.payoutReason,
    claim: null,
  };

  if (status.mode === "live" && !status.problem) {
    try {
      if ((await chain.treasuryBalance()) < cfg.amount) status.problem = "The reward pool is empty right now. Check back later.";
      const claim = found ? await getClaim(found.address) : null;
      const settled = claim ? await settlePending(chain, claim) : null;
      status.claim = settled ? publicClaim(settled) : null;
    } catch {
      status.problem = `Can't reach ${info.network} right now. Try again in a moment.`;
    }
  }

  return Response.json(status, { headers: { "cache-control": "no-store" } });
}
