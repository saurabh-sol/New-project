import { fundStatus } from "@/server/fund/service";

export async function GET(request: Request) {
  return Response.json(await fundStatus(new URL(request.url).searchParams.get("wallet")), { headers: { "cache-control": "no-store" } });
}
