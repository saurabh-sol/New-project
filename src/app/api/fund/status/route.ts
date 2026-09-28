import { fundStatus } from "@/server/fund/service";
import { parseWallet } from "@/server/rewards/challenge";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("wallet");
  return Response.json(await fundStatus(address ? parseWallet(address) : null), { headers: { "cache-control": "no-store" } });
}
