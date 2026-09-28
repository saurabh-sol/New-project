import type { ChallengeResponse } from "@/lib/rewards-types";
import { chainFor } from "@/server/chains";
import { isAgentId, issueChallenge } from "@/server/rewards/challenge";
import { rewardsConfig } from "@/server/rewards/config";
import { fail } from "@/server/rewards/http";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { wallet?: unknown; agent?: unknown } | null;
  const found = chainFor(body?.wallet);
  if (!found) return fail(400, "That doesn't look like a wallet address.");
  if (!isAgentId(body?.agent)) return fail(400, "Pick an agent to back first.");

  const challenge: ChallengeResponse = issueChallenge(found.address, body.agent, rewardsConfig().amount);
  return Response.json(challenge);
}
