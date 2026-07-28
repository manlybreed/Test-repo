import Anthropic from "@anthropic-ai/sdk";
import {
  SYSTEM_PROMPT,
  ceoTools,
  runCeoTool,
  CONFIRMATION_REQUIRED_TOOLS,
  describePendingAction,
} from "./tools";

export type PendingConfirmation = {
  toolName: string;
  toolInput: Record<string, unknown>;
  summary: string;
};

export type ToolLoopResult = {
  finalText: string;
  downloads: { label: string; href: string }[];
  pendingConfirmation: PendingConfirmation | null;
};

/**
 * The shared Claude tool-calling loop — extracted out of api/ai/chat's
 * route handler so /api/command (⌘K / voice) can run on the exact same
 * loop, with the full ceoTools array. That's what makes every tool ever
 * built for the assistant page (invoices, payroll, agreements, mail,
 * calendar) reachable from ⌘K and voice too, with zero new tool code —
 * a byproduct of sharing this loop, not separate work.
 *
 * Mutates `messages` in place as it runs (assistant/tool_result turns get
 * pushed on) — callers that need the final transcript can just read the
 * same array back afterward.
 */
export async function runToolLoop(
  anthropic: Anthropic,
  messages: Anthropic.MessageParam[],
  opts?: { maxTurns?: number; systemPromptPreamble?: string },
): Promise<ToolLoopResult> {
  const maxTurns = opts?.maxTurns ?? 6;
  // Prepended, not appended — a caller-specific instruction (e.g. the ⌘K
  // bar's "check for pure navigation first") needs to be evaluated before
  // the model settles into the tool-oriented reasoning the main prompt
  // otherwise leads with, not read as an afterthought at the end.
  const system = opts?.systemPromptPreamble
    ? `${opts.systemPromptPreamble}\n\n${SYSTEM_PROMPT}`
    : SYSTEM_PROMPT;
  let finalText = "";
  const downloads: { label: string; href: string }[] = [];
  let pendingConfirmation: PendingConfirmation | null = null;

  let guard = 0;
  while (guard < maxTurns) {
    guard += 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
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

    // Irreversible tools never execute from the model's own tool call —
    // pause here and hand the exact proposed call back to the caller as a
    // pending confirmation. This turn is discarded, not pushed onto
    // `messages` — the action only actually runs via /api/ai/confirm-tool,
    // reachable only from a real button click (ConfirmationCard).
    const confirmTool = toolUses.find((t) =>
      CONFIRMATION_REQUIRED_TOOLS.has(t.name),
    );
    if (confirmTool) {
      pendingConfirmation = {
        toolName: confirmTool.name,
        toolInput: confirmTool.input as Record<string, unknown>,
        summary: describePendingAction(confirmTool.name, confirmTool.input),
      };
      finalText = texts.join("\n") || "Please confirm this action:";
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
              parsed.number || parsed.clientName || parsed.employeeName || tool.name,
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

  return { finalText, downloads, pendingConfirmation };
}
