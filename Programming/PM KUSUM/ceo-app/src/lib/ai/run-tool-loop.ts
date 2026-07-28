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

export type ClientAction = {
  commandId: string;
  args: Record<string, unknown> | null;
};

export type ToolLoopResult = {
  finalText: string;
  downloads: { label: string; href: string }[];
  pendingConfirmation: PendingConfirmation | null;
  clientAction: ClientAction | null;
};

/**
 * Virtual tool name for triggering an already-registered client-side
 * command (src/lib/commands/registry.ts) from the model — the LLM
 * fallback tier for whatever the client's own fuzzy matcher (Tier 1)
 * missed. Not a real business action: this name is never passed to
 * runCeoTool, and callers must supply it via `opts.extraTools` (built
 * from the client's own currently-registered commands) for the model to
 * even see it as an option — there is no fixed schema for it here.
 */
export const CLIENT_ACTION_TOOL_NAME = "client_action";

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
  opts?: { maxTurns?: number; systemPromptPreamble?: string; extraTools?: Anthropic.Tool[] },
): Promise<ToolLoopResult> {
  const maxTurns = opts?.maxTurns ?? 6;
  // Prepended, not appended — a caller-specific instruction (e.g. the ⌘K
  // bar's "check for pure navigation first") needs to be evaluated before
  // the model settles into the tool-oriented reasoning the main prompt
  // otherwise leads with, not read as an afterthought at the end.
  const system = opts?.systemPromptPreamble
    ? `${opts.systemPromptPreamble}\n\n${SYSTEM_PROMPT}`
    : SYSTEM_PROMPT;
  const tools = opts?.extraTools?.length ? [...ceoTools, ...opts.extraTools] : ceoTools;
  let finalText = "";
  const downloads: { label: string; href: string }[] = [];
  let pendingConfirmation: PendingConfirmation | null = null;
  let clientAction: ClientAction | null = null;

  let guard = 0;
  while (guard < maxTurns) {
    guard += 1;
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system,
      tools,
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

    // A client-side command is resolved by the browser, not this server —
    // loop-terminal, same reasoning as the confirmation gate below: this
    // turn is discarded, not pushed onto `messages`. The caller (e.g.
    // /api/command) hands {commandId, args} back to the client, which
    // looks it up in the same handler map Tier 1's fuzzy matcher uses
    // (src/lib/commands/use-register-commands.ts's invokeCommand).
    const clientActionTool = toolUses.find(
      (t) => t.name === CLIENT_ACTION_TOOL_NAME,
    );
    if (clientActionTool) {
      const input = clientActionTool.input as { commandId?: string; args?: Record<string, unknown> };
      clientAction = {
        commandId: String(input.commandId || ""),
        args: input.args || null,
      };
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

  return { finalText, downloads, pendingConfirmation, clientAction };
}
