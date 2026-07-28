import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CONFIRMATION_REQUIRED_TOOLS, runCeoTool } from "@/lib/ai/tools";

/**
 * The only place an irreversible tool (see CONFIRMATION_REQUIRED_TOOLS)
 * actually executes. Reachable only from a real Confirm-button click
 * (ConfirmationCard) — never from the model's own tool call, which only
 * ever produces a `pendingConfirmation` payload for the client to render.
 * `confirmed: true` is set here, by this handler, not read from the
 * client — the client's job is to echo back exactly which pending action
 * it's confirming, not to assert it was confirmed.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const toolName = String(body.toolName || "");
  const toolInput = (body.toolInput || {}) as Record<string, unknown>;
  const threadId = body.threadId as string | undefined;

  if (!CONFIRMATION_REQUIRED_TOOLS.has(toolName)) {
    return NextResponse.json(
      { error: `${toolName || "This tool"} is not confirmable via this endpoint` },
      { status: 400 },
    );
  }

  if (threadId) {
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, userId: session.user.id },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
  }

  const raw = await runCeoTool(toolName, { ...toolInput, confirmed: true });

  const downloads: { label: string; href: string }[] = [];
  let ok = true;
  let errorMessage: string | undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.ok === false) {
      ok = false;
      errorMessage = parsed.error || "Action failed";
    }
    if (parsed.download) {
      downloads.push({
        label: parsed.number || parsed.clientName || parsed.employeeName || toolName,
        href: parsed.download,
      });
    }
  } catch {
    /* non-JSON tool result — treat as success text */
  }

  const reply = ok
    ? `Confirmed — ${describeConfirmedAction(toolName, raw)}`
    : `Couldn't complete that: ${errorMessage}`;

  if (threadId) {
    await prisma.chatMessage.create({
      data: {
        threadId,
        role: "assistant",
        content: reply,
        toolCalls: downloads.length ? downloads : undefined,
      },
    });
  }

  return NextResponse.json({ ok, reply, downloads });
}

function describeConfirmedAction(toolName: string, rawResult: string): string {
  if (toolName === "schedule_meeting") {
    try {
      const parsed = JSON.parse(rawResult);
      if (parsed.via === "google") {
        return parsed.meetLink
          ? `meeting scheduled, Meet link: ${parsed.meetLink}`
          : "meeting scheduled.";
      }
      if (parsed.via === "ics") {
        return "Calendar isn't connected for this mailbox, so a downloadable .ics invite was created instead — open it from Mail > Schedule a meeting to send it.";
      }
      return "meeting scheduled.";
    } catch {
      return "meeting scheduled.";
    }
  }
  if (toolName === "trash_mail_thread") return "thread moved to Trash.";
  if (toolName === "bulk_trash_mail_threads") {
    try {
      const parsed = JSON.parse(rawResult);
      const n = parsed.count ?? "the";
      return `${n} thread${n === 1 ? "" : "s"} moved to Trash.`;
    } catch {
      return "threads moved to Trash.";
    }
  }
  if (toolName === "send_mail") {
    try {
      const parsed = JSON.parse(rawResult);
      const to = Array.isArray(parsed.to) ? parsed.to.join(", ") : "";
      if (parsed.ok) return `email sent to ${to || "the recipient"}.`;
      return `send failed: ${parsed.error || "unknown error"}`;
    } catch {
      return "email sent.";
    }
  }
  return "done.";
}
