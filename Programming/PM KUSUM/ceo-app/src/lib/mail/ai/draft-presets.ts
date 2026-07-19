/** Shared client/server draft tone + refine presets (no server imports). */

export const DEFAULT_DRAFT_TONE =
  "warm professional — concise, clear, respectful; CEO voice for BluRidge Consulting; no fluff; no invented commitments";

export type DraftRefinePresetId =
  | "shorter"
  | "formal"
  | "warmer"
  | "direct"
  | "add_cta"
  | "softer_no"
  | "urgency"
  | "cut_fluff";

export const DRAFT_REFINE_PRESETS: {
  id: DraftRefinePresetId;
  label: string;
  instruction: string;
}[] = [
  {
    id: "shorter",
    label: "Make shorter",
    instruction: "Cut length by ~40% while keeping the same meaning and any concrete asks.",
  },
  {
    id: "formal",
    label: "More formal",
    instruction: "Raise formality slightly; keep it natural, not stiff or bureaucratic.",
  },
  {
    id: "warmer",
    label: "Warmer",
    instruction: "Make the tone warmer and more personable without sounding casual or salesy.",
  },
  {
    id: "direct",
    label: "More direct",
    instruction: "Be more direct and decisive; lead with the point, then brief context.",
  },
  {
    id: "add_cta",
    label: "Add clear CTA",
    instruction:
      "End with one clear next step / call to action (meeting, confirmation, or deadline) without inventing facts.",
  },
  {
    id: "softer_no",
    label: "Softer decline",
    instruction:
      "If declining or pushing back, soften it while staying clear; offer a constructive alternative if grounded in the thread.",
  },
  {
    id: "urgency",
    label: "Emphasize timeline",
    instruction:
      "Emphasize timing or urgency only if already implied in the thread; do not invent deadlines.",
  },
  {
    id: "cut_fluff",
    label: "Cut fluff",
    instruction: "Remove pleasantries and filler; keep gratitude to one short line max.",
  },
];
