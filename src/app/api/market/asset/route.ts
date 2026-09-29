import { previewAsset } from "@/server/requests/service";

/** Looks up a Solana token by its address, so a funder can see what they are asking for. */
export async function GET(request: Request) {
  const preview = await previewAsset(new URL(request.url).searchParams.get("address"));
  return Response.json(preview, { status: preview.ok ? 200 : 400, headers: { "cache-control": "no-store" } });
}
