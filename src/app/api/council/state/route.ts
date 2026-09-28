import { snapshot } from "@/server/council/session";

export async function GET() {
  return Response.json(await snapshot(), { headers: { "cache-control": "no-store" } });
}
