import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { runExtractAll } from "@/actions/projects";
import { formatAnthropicError } from "@/lib/projects/doc-content";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Optimized Run All — Land → Plant KYC → S1 → S23+CIBIL → S4 (NDJSON progress). */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let plantId = "";
  let force = false;
  try {
    const body = (await req.json()) as { plantId?: string; force?: boolean };
    plantId = body.plantId?.trim() || "";
    force = body.force === true;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400 });
  }
  if (!plantId) {
    return new Response(JSON.stringify({ error: "plantId required" }), { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      try {
        send({ pct: 1, step: "Starting optimized Run All…", extractStep: "land" });
        const result = await runExtractAll(plantId, {
          force,
          onProgress: async (p) => {
            send({
              pct: p.pct,
              step: p.step,
              extractStep: p.extractStep,
              skipped: p.skipped,
            });
          },
        });
        send({ pct: 100, step: "Done", result });
      } catch (err) {
        send({
          error: formatAnthropicError(err),
          pct: 0,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
