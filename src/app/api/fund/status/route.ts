import { fundStatus } from "@/server/fund/service";
import { clientIp } from "@/server/rewards/http";

export async function GET(request: Request) {
  return Response.json(await fundStatus(new URL(request.url).searchParams.get("wallet"), clientIp(request)), { headers: { "cache-control": "no-store" } });
}
