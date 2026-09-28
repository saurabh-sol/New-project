import type { ChallengeResponse } from "@/lib/rewards-types";
import { isAgentId, issueChallenge, parseWallet } from "@/server/rewards/challenge";
import { rewardsConfig } from "@/server/rewards/config";
import { fail } from "@/server/rewards/http";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { wallet?: unknown; agent?: unknown } | null;
  const wallet = parseWallet(body?.wallet);
  if (!wallet) return fail(400, "That doesn't look like a Solana wallet address.");
  if (!isAgentId(body?.agent)) return fail(400, "Pick an agent to back first.");

  const challenge: ChallengeResponse = issueChallenge(wallet.toBase58(), body.agent, rewardsConfig().amount);
  return Response.json(challenge);
}
