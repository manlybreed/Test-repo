"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Square } from "lucide-react";

import { haptic } from "@/components/mail/haptics";
import { useSpeechToText } from "@/components/voice/use-speech-to-text";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

/**
 * Universal voice-command mic button — press it, speak one instruction,
 * and `onText` fires with the transcript. Used both for free-text dictation
 * (mail's AI Draft brief/refine/Ask fields fill themselves and immediately
 * act) and for command dispatch (the global entry point in ceo-shell.tsx
 * resolves the transcript against the shared command registry). Renders
 * nothing on browsers without SpeechRecognition (Firefox, Safari) rather
 * than showing a mic that silently does nothing when clicked.
 */
export function VoiceButton({
  onText,
  size = "md",
  disabled,
}: {
  onText: (text: string) => void;
  size?: "md" | "lg";
  disabled?: boolean;
}) {
  const { supported, listening, error, toggle } = useSpeechToText(onText);
  const dim = size === "lg" ? "h-9 w-9" : "h-8 w-8";

  useEffect(() => {
    if (error) haptic("warn");
  }, [error]);

  // Web Speech API is Chrome/Edge-only — unfixable from here, so this
  // stays a visible, clearly-labeled disabled state (real tooltip on
  // hover) rather than the mic silently vanishing with no explanation.
  if (!supported) {
    return (
      <button
        type="button"
        title="Voice commands need Chrome or Edge — not supported in this browser"
        aria-label="Voice commands unavailable in this browser"
        disabled
        className={`flex ${dim} shrink-0 cursor-not-allowed items-center justify-center rounded-full opacity-40`}
        style={{
          background: "var(--bg-elevated)",
          color: "var(--text-dim)",
          border: "1px solid var(--border-strong)",
        }}
      >
        <MicOff size={14} />
      </button>
    );
  }

  const title = listening ? "Stop voice command" : "Voice command";

  return (
    <motion.button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      whileHover={{ y: -1, scale: 1.06 }}
      whileTap={{ scale: 0.9 }}
      transition={spring}
      onClick={() => {
        haptic(error ? "warn" : "tap");
        toggle();
      }}
      className={`flex ${dim} shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40`}
      style={{
        background: listening
          ? "var(--mail-purple-dim)"
          : error
            ? "rgba(239,68,68,0.12)"
            : "var(--bg-elevated)",
        color: listening ? "#c4b5fd" : error ? "#f87171" : "var(--text-muted)",
        border: "1px solid var(--border-strong)",
      }}
    >
      {listening ? <Square size={13} /> : <Mic size={14} />}
    </motion.button>
  );
}
