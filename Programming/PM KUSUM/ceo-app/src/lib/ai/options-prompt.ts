/**
 * Pure logic for turning a calendar tool's result into clickable options
 * — deliberately has zero imports from tools.ts/action files (those pull
 * in NextAuth, which needs the Next.js server runtime and breaks under
 * plain vitest, exactly the reason tool-confirmation.ts is its own leaf
 * module too). run-tool-loop.ts imports this directly.
 */

/** A small enumerable choice the CEO can click instead of typing — e.g.
 * candidate meeting slots or a list of events to pick from. `value` is
 * the exact string the CEO would have typed back; a click sends it
 * through the surface's existing send-message path, so from the model's
 * point of view it's indistinguishable from the CEO typing it — no new
 * protocol. */
export type OptionsPrompt = {
  label: string;
  options: { value: string; label: string }[];
};

export type CalendarToolCall = {
  name: "check_calendar_availability" | "list_calendar_events";
  result: string;
};

const OPTIONS_MAX = 8;

/** Turns the most recently *executed* check_calendar_availability/
 * list_calendar_events tool result into clickable options — reusing
 * each tool's own already-formatted labels (formatSlotForDisplay's
 * output for slots, list_calendar_events' `when` for events) so the
 * chips and the model's own prose never describe the same time
 * differently. Returns null when the last executed tool call wasn't one
 * of these two, or came back empty — most turns have no options at all. */
export function buildOptionsPrompt(last: CalendarToolCall | null): OptionsPrompt | null {
  if (!last) return null;
  try {
    const parsed = JSON.parse(last.result);
    if (last.name === "check_calendar_availability") {
      const slots = Array.isArray(parsed.slots) ? parsed.slots : [];
      if (!slots.length) return null;
      return {
        label: "Pick a time",
        options: slots
          .slice(0, OPTIONS_MAX)
          .map((s: { label: string }) => ({ value: s.label, label: s.label })),
      };
    }
    const events = Array.isArray(parsed.events) ? parsed.events : [];
    if (!events.length) return null;
    return {
      label: "Pick an event",
      options: events
        .slice(0, OPTIONS_MAX)
        .map((e: { title: string; when: string }) => ({
          value: `${e.title} (${e.when})`,
          label: `${e.title} — ${e.when}`,
        })),
    };
  } catch {
    return null;
  }
}
