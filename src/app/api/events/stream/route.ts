import { ensureEventProcessor, eventIngestionStatus } from "@/server/events/event-processor";
import { subscribeEvents } from "@/server/events/event-hub";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  ensureEventProcessor();
  const encoder = new TextEncoder();
  let unsubscribe = () => undefined as void;
  let beat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const status = eventIngestionStatus();
      controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ running: status.running })}\n\n`));
      unsubscribe = subscribeEvents((payload) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      });
      beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (beat) clearInterval(beat);
        }
      }, 20000);
    },
    cancel() {
      unsubscribe();
      if (beat) clearInterval(beat);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
