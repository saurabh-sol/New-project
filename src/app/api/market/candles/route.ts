import { isCrypto, isInterval, isToken } from "@/lib/market";
import { readState } from "@/server/council/store";
import { assetCandles } from "@/server/market/assets";
import { stockCandles } from "@/server/market/stocks";

/**
 * Candles for a listed Stock Token, or for a token a funder asked the desk to trade.
 * Crypto is charted by the browser straight from the exchange feed.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token") ?? "";
  const span = params.get("interval");
  if (!isInterval(span)) return Response.json({ error: "Unknown interval." }, { status: 400 });

  try {
    if (isToken(token) && !isCrypto(token)) return Response.json({ candles: await stockCandles(token, span, 300) }, { headers: { "cache-control": "no-store" } });
    const asset = (await readState()).assets[token];
    if (!asset) return Response.json({ error: "Unknown token." }, { status: 400 });
    return Response.json({ candles: await assetCandles(asset, span, 300) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Candles for this token can't be reached right now." }, { status: 502 });
  }
}
