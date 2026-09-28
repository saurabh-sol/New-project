import { faucet } from "@/server/fund/service";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { wallet?: unknown } | null;
  const result = await faucet(body?.wallet);
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
