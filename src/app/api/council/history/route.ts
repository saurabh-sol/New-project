import { loadHistory } from "@/server/council/memory";

const MOST = 12;
/** Later than any session there will ever be, and still a number the database can hold. */
const NO_LIMIT = 2_000_000_000;

/** Past sessions, newest first, so any visitor on any device can read what the desk has said. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const before = Number(params.get("before"));
  const limit = Math.min(Math.max(Math.floor(Number(params.get("limit")) || 6), 1), MOST);
  try {
    const history = await loadHistory(Number.isInteger(before) && before > 0 && before < NO_LIMIT ? before : NO_LIMIT, limit);
    return Response.json(history, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[council] could not read the desk's history:", e instanceof Error ? e.message : e);
    return Response.json({ error: "The desk's history can't be reached right now." }, { status: 502 });
  }
}
