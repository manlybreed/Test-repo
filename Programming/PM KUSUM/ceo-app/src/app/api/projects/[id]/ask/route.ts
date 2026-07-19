import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolvePlantProfile } from "@/lib/projects/plant-profile";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatTurn = { role: "user" | "assistant"; content: string };

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated]`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set." },
      { status: 503 },
    );
  }

  const { id: plantId } = await ctx.params;
  let message = "";
  let history: ChatTurn[] = [];
  try {
    const body = (await req.json()) as {
      message?: string;
      history?: ChatTurn[];
    };
    message = String(body.message || "").trim();
    history = Array.isArray(body.history) ? body.history.slice(-12) : [];
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  const plant = await prisma.kusumPlant.findUnique({ where: { id: plantId } });
  if (!plant) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  const profile = resolvePlantProfile(plant);
  let complianceSummary = "";
  try {
    if (plant.rawExtract) {
      const raw = JSON.parse(plant.rawExtract) as Record<string, unknown>;
      const c = raw.compliance as Record<string, unknown> | undefined;
      if (c) {
        complianceSummary = JSON.stringify(c, null, 2);
      }
    }
  } catch {
    /* ignore */
  }

  const system = `You are the plant-specific AI assistant for one PM KUSUM solar plant in BluRidge CEO Projects.
Answer ONLY about this plant using the context below. If something is not in the context, say you don't see it in the extracts and suggest which checkpoint to run (Land KYC, Section 1, Section 2–3/CIBIL, Section 4, or Run all).
Be concise. Call out red flags clearly (CIBIL, khasra mismatches, GST vs MCA director mismatches).

PLANT
- Name: ${plant.name}
- Folder: ${plant.folderPath}
- Status: ${plant.status}
- Profile: capacity=${profile.capacityMw ?? "—"}, tehsil=${profile.tehsil ?? "—"}, district=${profile.district ?? "—"}, tariff=${profile.tariff ?? "—"}, dpr/loa=${profile.dprName ?? "—"}, bank=${profile.bankName ?? "—"}
- Extract summary: ${plant.extractSummary ?? "—"}
- Notes: ${plant.notes ?? "—"}

COMPLIANCE JSON
${clip(complianceSummary || "(none yet — run extracts)", 12_000)}

RAW EXTRACT JSON (source of truth for sections)
${clip(plant.rawExtract || "(empty)", 100_000)}
`;

  const messages: Anthropic.MessageParam[] = [
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    { role: "user", content: message },
  ];

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system,
      messages,
    });
    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return NextResponse.json({
      reply: reply || "No answer generated.",
      plantId: plant.id,
      plantName: plant.name,
    });
  } catch (err) {
    console.error("[/api/projects/[id]/ask]", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "AI request failed",
      },
      { status: 500 },
    );
  }
}
