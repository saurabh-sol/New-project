/** Says the server is up. Asked by the host to decide whether a deploy is healthy; it touches nothing else. */
export function GET() {
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
