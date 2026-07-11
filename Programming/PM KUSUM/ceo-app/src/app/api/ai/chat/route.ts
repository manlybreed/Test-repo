import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SYSTEM_PROMPT, ceoTools, runCeoTool } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY is not set. Add it to ceo-app/.env and restart the server.",
      },
      { status: 503 },
    );
  }

  const body = await req.json();
  const message = String(body.message || "").trim();
  let threadId = body.threadId as string | undefined;

  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  if (!threadId) {
    const thread = await prisma.chatThread.create({
      data: {
        userId: session.user.id,
        title: message.slice(0, 60),
      },
    });
    threadId = thread.id;
  }

  await prisma.chatMessage.create({
    data: { threadId, role: "user", content: message },
  });

  const history = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: 40,
  });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  type Msg = Anthropic.MessageParam;
  const messages: Msg[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  let finalText = "";
  const downloads: { label: string; href: string }[] = [];
  let guard = 0;

  while (guard < 6) {
    guard += 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: ceoTools,
      messages,
    });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const texts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);

    if (toolUses.length === 0) {
      finalText = texts.join("\n") || "Done.";
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      const result = await runCeoTool(tool.name, tool.input);
      try {
        const parsed = JSON.parse(result);
        if (parsed.download) {
          downloads.push({
            label:
              parsed.number ||
              parsed.clientName ||
              parsed.employeeName ||
              tool.name,
            href: parsed.download,
          });
        }
      } catch {
        /* ignore */
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: result,
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn" && texts.length) {
      finalText = texts.join("\n");
    }
  }

  if (!finalText) {
    finalText =
      downloads.length > 0
        ? "Completed. Documents are ready to download."
        : "Completed.";
  }

  await prisma.chatMessage.create({
    data: {
      threadId: threadId!,
      role: "assistant",
      content: finalText,
      toolCalls: downloads.length ? downloads : undefined,
    },
  });

  return NextResponse.json({
    threadId,
    reply: finalText,
    downloads,
  });
}
