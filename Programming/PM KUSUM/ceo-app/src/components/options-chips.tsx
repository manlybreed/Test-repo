"use client";

import { useState } from "react";
import { haptic } from "@/components/mail/haptics";

export type OptionsPrompt = {
  label: string;
  options: { value: string; label: string }[];
};

/**
 * A row of clickable options accompanying an assistant reply — e.g. real
 * candidate meeting slots or existing events to pick from — so the CEO
 * can click instead of retyping what they just read. Clicking sends the
 * option's exact value through the parent's own "send this text as the
 * next message" function (already the same path the text input uses),
 * then this row hides itself so a stale set of options from an
 * already-moved-on turn can't be clicked twice.
 */
export function OptionsChips({
  prompt,
  onPick,
  disabled,
}: {
  prompt: OptionsPrompt;
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  if (picked) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
        <span>✓</span>
        <span>{picked}</span>
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="mb-1.5 text-[0.65rem] uppercase tracking-wide" style={{ color: "var(--text-dim)" }}>
        {prompt.label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {prompt.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              background: "var(--accent-dim)",
              color: "var(--accent-bright)",
              border: "1px solid transparent",
            }}
            onClick={() => {
              haptic("tap");
              setPicked(opt.label);
              onPick(opt.value);
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
