import { readState } from "@/server/council/store";
import { assetCandles, isSpan } from "@/server/market/assets";

/** Candles for a token a funder asked the desk to trade. Listed tokens are charted straight from the exchange feed. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const span = params.get("interval");
  const asset = (await readState()).assets[params.get("token") ?? ""];
  if (!asset || !isSpan(span)) return Response.json({ error: "Unknown token or interval." }, { status: 400 });
  try {
    return Response.json({ candles: await assetCandles(asset, span, 300) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Candles for this token can't be reached right now." }, { status: 502 });
  }
}
