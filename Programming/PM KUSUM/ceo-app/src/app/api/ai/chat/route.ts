import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runToolLoop } from "@/lib/ai/run-tool-loop";

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
  } else {
    // Verify thread belongs to this user
    const thread = await prisma.chatThread.findFirst({
      where: { id: threadId, userId: session.user.id },
      select: { id: true },
    });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    }
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
  let downloads: { label: string; href: string }[] = [];
  let pendingConfirmation: Awaited<ReturnType<typeof runToolLoop>>["pendingConfirmation"] =
    null;
  let optionsPrompt: Awaited<ReturnType<typeof runToolLoop>>["optionsPrompt"] = null;

  try {
    const result = await runToolLoop(anthropic, messages);
    finalText = result.finalText;
    downloads = result.downloads;
    pendingConfirmation = result.pendingConfirmation;
    optionsPrompt = result.optionsPrompt;
  } catch (err) {
    console.error("[/api/ai/chat] Anthropic error:", err);
    const errMsg =
      err instanceof Error ? err.message : "AI request failed. Please try again.";
    await prisma.chatMessage.create({
      data: {
        threadId: threadId!,
        role: "assistant",
        content: `Sorry, I encountered an error: ${errMsg}`,
      },
    });
    return NextResponse.json(
      { threadId, reply: `Sorry, I encountered an error: ${errMsg}`, downloads: [] },
      { status: 500 },
    );
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
    pendingConfirmation,
    optionsPrompt,
  });
}
