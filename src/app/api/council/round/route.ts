import { loadRound } from "@/server/council/memory";
import { joinRound } from "@/server/council/session";

// A session is up to a minute of model calls, streamed as it is produced.
export const maxDuration = 300;

/** The record of a finished session, for showing its conversation without playing it again. */
export async function GET(request: Request) {
  const round = Number(new URL(request.url).searchParams.get("round"));
  const stages = Number.isInteger(round) && round > 0 ? await loadRound(round).catch(() => null) : null;
  if (!stages) return Response.json({ error: "That session is not on record." }, { status: 404 });
  return Response.json({ stages }, { headers: { "cache-control": "no-store" } });
}

/** Streams a council session as newline-delimited JSON, one stage per line. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { seen?: unknown } | null;
  const seen = Number.isInteger(body?.seen) ? (body!.seen as number) : 0;

  const joined = await joinRound(seen);
  if (joined.kind === "wait") {
    return Response.json({ wait: joined.wait, nextRoundAt: joined.nextRoundAt }, { headers: { "cache-control": "no-store" } });
  }
  const { run } = joined;
  // A session that had already ended when the viewer asked is shown as a replay, not as live.
  const replay = run.done;

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const stage of run.follow()) {
        if (!open) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(stage)}\n`));
      }
      if (open) controller.close();
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-council-replay": replay ? "1" : "0" },
  });
}
