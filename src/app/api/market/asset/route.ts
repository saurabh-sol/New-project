import { previewAsset } from "@/server/requests/service";

/** Looks up a token on Robinhood Chain by address, or a Stock Token by symbol, so a funder can see what they are asking for. */
export async function GET(request: Request) {
  const preview = await previewAsset(new URL(request.url).searchParams.get("token"));
  return Response.json(preview, { status: preview.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}
