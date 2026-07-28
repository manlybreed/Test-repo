import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { runToolLoop } from "@/lib/ai/run-tool-loop";

/**
 * Appended to the shared assistant SYSTEM_PROMPT only for this endpoint —
 * the ⌘K bar has no conversation memory between calls (unlike
 * /ceo/assistant's persisted chat threads), and needs a way to express
 * pure navigation without a real tool call, since "navigate" isn't a
 * business action any assistant tool performs.
 */
const COMMAND_BAR_SUFFIX = `You are being invoked from the ⌘K quick-command bar, not the full assistant chat — there is no memory between calls, so resolve this single request fully now.

FIRST, before considering any tool: is this ENTIRELY a request to go to a page, with no other action needed ("open X", "take me to X", "go to the X section")? Every one of these pages genuinely exists in this app, even ones you have no tool for (Ledgers and Time Tracker have no assistant tool at all — they're still real, navigable pages, not missing features):
/ceo (overview), /ceo/assistant, /ceo/mail, /ceo/clients, /ceo/projects, /ceo/financing, /ceo/agreements, /ceo/invoices, /ceo/ledgers, /ceo/payroll, /ceo/employees, /ceo/time, /ceo/expenses.
If so, your ENTIRE reply must be exactly this, nothing else — no punctuation, no explanation, no markdown: [[navigate:/ceo/xyz]]
Example: "take me to the ledgers section" → [[navigate:/ceo/ledgers]]
Example: "open time tracker" → [[navigate:/ceo/time]]
Never answer "I don't have that section" for any path in the list above — trust the list over your own tool inventory.

Otherwise, if the request needs a business action (create/list/check/schedule/archive/send/etc.), call the right tool(s) directly — do not just describe what you would do or link to a page for it.

If required details are genuinely missing, ask one concise clarifying question as your reply — the CEO can retype a fuller command in the same bar.

Keep any final text reply brief (1-3 sentences) — this is a quick command bar, not a chat window.`;

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

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: query }];
    const result = await runToolLoop(anthropic, messages, {
      systemPromptPreamble: COMMAND_BAR_SUFFIX,
    });

    const navMatch = result.finalText
      .trim()
      .match(/^\[\[navigate:(\/ceo[a-z0-9/_-]*)\]\]$/i);
    if (navMatch) {
      return NextResponse.json({ type: "navigate", href: navMatch[1] });
    }

    if (result.pendingConfirmation) {
      return NextResponse.json({
        type: "confirm",
        content: result.finalText,
        pendingConfirmation: result.pendingConfirmation,
      });
    }

    return NextResponse.json({
      type: "text",
      content: result.finalText,
      downloads: result.downloads,
    });
  } catch (err) {
    console.error("[/api/command]", err);
    return NextResponse.json(
      { type: "error", error: "Failed to process command." },
      { status: 500 },
    );
  }
}
