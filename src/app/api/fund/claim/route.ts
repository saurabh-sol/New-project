import { claimBonus } from "@/server/fund/service";
import { clientIp } from "@/server/rewards/http";

// Waits for the network to confirm the payment.
export const maxDuration = 120;

/** Pays the wallet's first-deposit bonus to it, once its lock has passed. One claim per address on the network per cooldown. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { wallet?: unknown } | null;
  const result = await claimBonus(body?.wallet, clientIp(request));
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
