import { faucet } from "@/server/fund/service";
import { parseWallet } from "@/server/rewards/challenge";
import { fail } from "@/server/rewards/http";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { wallet?: unknown } | null;
  const wallet = parseWallet(body?.wallet);
  if (!wallet) return fail(400, "That doesn't look like a Solana wallet address.");
  const result = await faucet(wallet);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
