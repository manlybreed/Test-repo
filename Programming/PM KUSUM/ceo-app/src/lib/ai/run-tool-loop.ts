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
  // Computed fresh per call (never baked into the static SYSTEM_PROMPT
  // constant) so the model always has real "now" grounding for relative
  // dates ("this week", "tomorrow") — list_calendar_events and
  // update_calendar_event ask the model to supply its own ISO date
  // range/time directly, unlike check_calendar_availability's
  // server-computed slots, so without this the model has nothing but its
  // own training-time sense of the date to fall back on. That's the exact
  // hallucination class already seen once in this codebase (a meeting
  // scheduled a year in the wrong direction) — this closes it for every
  // date-sensitive tool, not just the calendar ones, since it's injected
  // once here in the shared loop.
  const now = new Date();
  // Computed as an IST wall-clock label, not a raw UTC ISO string handed
  // to the model to convert itself — live testing caught the model
  // reading a UTC timestamp's own calendar date as "today" (e.g. calling
  // 2026-08-01T00:03 IST "July 31" because that instant's UTC date is
  // still the 31st), the exact "let code compute it, don't make the
  // model compute it" lesson this codebase already applies to slot
  // generation, just missed here on the first pass.
  const istDateLabel = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const istTimeLabel = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
  });
  const dateContext = `Right now it is ${istDateLabel}, ${istTimeLabel} IST (Asia/Kolkata, UTC+5:30). Treat this as "today"/"now" for any relative date/time reasoning — this week, tomorrow, next Monday, etc. — and compute ISO datetimes for tool calls relative to this IST date, not the UTC calendar date of any timestamp you see elsewhere. Never guess or rely on your own sense of the current date.`;
  // Prepended, not appended — a caller-specific instruction (e.g. the ⌘K
  // bar's "check for pure navigation first") needs to be evaluated before
  // the model settles into the tool-oriented reasoning the main prompt
  // otherwise leads with, not read as an afterthought at the end.
  const system = [dateContext, opts?.systemPromptPreamble, SYSTEM_PROMPT]
    .filter(Boolean)
    .join("\n\n");
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
