import { listedQuotes } from "@/server/market/quotes";

/** Live quotes for the tokens the desk lists. */
export async function GET() {
  try {
    return Response.json({ quotes: await listedQuotes() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Market data can't be reached right now." }, { status: 502 });
  }
}
