import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { SYSTEM_PROMPT } from "@/lib/ai/tools";

const COMMAND_SYSTEM = `You are the ⌘K command bar for the BluRidge CEO Command Center.
You route quick commands to the right page or give brief policy answers.
You do NOT have access to live database data — never guess counts, amounts, IDs, or statuses from memory.

IMPORTANT — respond with ONLY a JSON object, no markdown, no explanation:

For navigation intent:
{"type":"navigate","href":"/ceo/agreements"}

For create/action intent:
{"type":"action","label":"Create Agreement","href":"/ceo/agreements","content":"Head to Agreements to fill in the client details."}

For policy/rate/process questions you can answer from general knowledge:
{"type":"text","content":"...1-2 sentence answer..."}

For ANY question about live data (counts, latest invoice number, how much was spent, which agreements are draft, employee list, etc.):
{"type":"navigate","href":"/ceo/assistant","content":"Opening the AI assistant — it can query your live data to answer that."}

Navigation URLs:
- /ceo — overview dashboard
- /ceo/assistant — AI chat (has full database access, use for all data questions)
- /ceo/agreements — agreements
- /ceo/invoices — invoices
- /ceo/payroll — payroll & salary slips
- /ceo/time — time tracker & Pomodoro
- /ceo/expenses — expense manager

Rules:
1. GO somewhere → navigate
2. CREATE something → action with the right page
3. Policy/rate question → text (keep to 1-2 sentences)
4. ANY live data question → navigate to /ceo/assistant
`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ type: "error", error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { type: "error", error: "ANTHROPIC_API_KEY is not configured." },
      { status: 503 },
    );
  }

  try {
    const { query } = (await req.json()) as { query: string };
    if (!query?.trim()) {
      return NextResponse.json({ type: "error", error: "Empty query" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: COMMAND_SYSTEM,
      messages: [{ role: "user", content: query }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[/api/command]", err);
    return NextResponse.json(
      { type: "error", error: "Failed to process command." },
      { status: 500 },
    );
  }
}
