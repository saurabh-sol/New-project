import { RoundRun } from "@/server/council/round";
import { joinRound } from "@/server/council/session";

/** Streams a council session as newline-delimited JSON, one stage per line. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { seen?: unknown } | null;
  const seen = Number.isInteger(body?.seen) ? (body!.seen as number) : 0;

  const joined = await joinRound(seen);
  if (!(joined instanceof RoundRun)) return Response.json(joined, { headers: { "cache-control": "no-store" } });

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const stage of joined.follow()) {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(stage)}\n`));
      }
      if (open) controller.close();
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
