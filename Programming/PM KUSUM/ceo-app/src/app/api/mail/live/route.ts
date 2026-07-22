import { auth } from "@/lib/auth";
import { getMailLiveBus, type MailLiveEvent } from "@/lib/mail/live-bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** SSE stream of IMAP IDLE / sync updates for the mail UI. */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const bus = getMailLiveBus();
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      const send = (
        event: MailLiveEvent | { type: "hello" | "ping"; at: string },
      ) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          cleanup?.();
        }
      };

      const onMail = (event: MailLiveEvent) => send(event);
      bus.on("mail", onMail);

      send({ type: "hello", at: new Date().toISOString() });

      const ping = setInterval(() => {
        send({ type: "ping", at: new Date().toISOString() });
      }, 25_000);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        bus.off("mail", onMail);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
