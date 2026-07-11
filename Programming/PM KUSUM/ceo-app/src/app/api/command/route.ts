import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/ai/tools";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const COMMAND_SYSTEM = `${SYSTEM_PROMPT}

You are responding to a quick command from the CEO command bar (⌘K palette).

IMPORTANT — respond with ONLY a JSON object, no markdown, no explanation:

For navigation intent:
{"type":"navigate","href":"/ceo/agreements"}

For actions that require filling a form / going to a page:
{"type":"action","label":"Create Agreement","href":"/ceo/agreements","content":"Head to Agreements to fill in the client details and generate the DOCX."}

For direct answers / summaries:
{"type":"text","content":"...your concise answer..."}

For errors:
{"type":"error","error":"...reason..."}

Navigation URLs available:
- /ceo — overview
- /ceo/assistant — AI chat assistant (use for multi-step or complex requests)
- /ceo/agreements — create or view agreements
- /ceo/invoices — create or view invoices  
- /ceo/payroll — payroll, salary slips, employees
- /ceo/time — time tracker and Pomodoro

Routing rules:
1. If the user wants to GO to a section → {"type":"navigate","href":"..."}
2. If the user wants to CREATE something → {"type":"action",...} pointing to the right page
3. If the user asks a question about fees, GST, rates, or the company → {"type":"text",...}
4. For complex multi-step tasks → route to /ceo/assistant with a note
5. Keep "content" to 1-2 short sentences max.
`;

export async function POST(req: NextRequest) {
  try {
    const { query } = (await req.json()) as { query: string };
    if (!query?.trim()) {
      return NextResponse.json({ type: "error", error: "Empty query" }, { status: 400 });
    }

    const msg = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 256,
      system: COMMAND_SYSTEM,
      messages: [{ role: "user", content: query }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";

    // Strip any accidental markdown fences
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
