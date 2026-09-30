import { previewAsset } from "@/server/requests/service";

/** Looks up a token on Robinhood Chain by address, or a Stock Token by symbol, so a funder can see what they are asking for. */
export async function GET(request: Request) {
  const preview = await previewAsset(new URL(request.url).searchParams.get("token"));
  // A token the desk won't trade is an answer like any other. Only data that can't be reached is a failure.
  return Response.json(preview, { status: !preview.ok && preview.unavailable ? 503 : 200, headers: { "cache-control": "no-store" } });
}
