"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal ad-hoc types for the Web Speech API's SpeechRecognition — it's
 * still non-standard (webkit-prefixed in Chrome/Edge, absent in Firefox/
 * Safari) and isn't part of lib.dom.d.ts, so there's nothing to import.
 */
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: { transcript: string };
}
interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechToTextSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/**
 * Voice-command capture for a single AI-assist field: press the mic, speak
 * one instruction/question, and the recognizer auto-stops on silence and
 * hands back the transcript — like Siri/Google Assistant's "speak your
 * command" pattern, not open-ended dictation. Built on the Web Speech API
 * (Chrome/Edge only today — Firefox/Safari have no implementation), so
 * callers must check `supported` and hide the mic button entirely rather
 * than showing a control that silently does nothing when clicked.
 */
export function useSpeechToText(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const supported = isSpeechToTextSupported();

  const start = useCallback(() => {
    if (!supported || recognitionRef.current) return;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    // One command per press — the browser auto-stops on silence and fires
    // a single final result, instead of staying open for open-ended dictation.
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) finalText += result[0]?.transcript ?? "";
      }
      if (finalText.trim()) onResultRef.current(finalText.trim());
    };
    rec.onerror = (event) => {
      // "no-speech"/"aborted" fire routinely (pause, manual stop) — not
      // real failures worth surfacing.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error);
      }
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [supported]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Stop listening on unmount (e.g. closing the compose panel mid-dictation)
  // rather than leaking a live mic stream.
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  return { supported, listening, error, start, stop, toggle };
}
