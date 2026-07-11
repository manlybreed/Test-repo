"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";

type ResultState =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "text"; content: string }
  | { type: "action"; label: string; href?: string; content?: string }
  | { type: "error"; message: string };

const QUICK_CMDS = [
  { label: "New Agreement", icon: "◈", query: "create new agreement" },
  { label: "New Invoice",   icon: "◇", query: "create new invoice" },
  { label: "Add Employee",  icon: "◉", query: "add new employee" },
  { label: "Start Timer",   icon: "◎", query: "start pomodoro timer" },
  { label: "Go to Assistant", icon: "✦", query: "open ai assistant" },
];

export function CommandBar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResultState>({ type: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setQuery("");
      setResult({ type: "idle" });
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(q: string) {
    const trimmed = (q || query).trim();
    if (!trimmed) return;

    // Fast client-side navigation shortcuts
    const nav = detectNavIntent(trimmed);
    if (nav) {
      onClose();
      router.push(nav);
      return;
    }

    setResult({ type: "thinking" });

    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      const data = await res.json() as { type: string; content?: string; label?: string; href?: string; error?: string };

      if (data.type === "navigate" && data.href) {
        onClose();
        router.push(data.href);
        return;
      }
      if (data.type === "action") {
        setResult({ type: "action", label: data.label || "", href: data.href, content: data.content });
        return;
      }
      if (data.type === "error") {
        setResult({ type: "error", message: data.error || "Something went wrong" });
        return;
      }
      setResult({ type: "text", content: data.content || "" });
    } catch {
      setResult({ type: "error", message: "Network error — is the server running?" });
    }
  }

  function detectNavIntent(q: string): string | null {
    const lower = q.toLowerCase();
    if (/\b(agreement|agreements)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/agreements";
    if (/\b(invoice|invoices)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/invoices";
    if (/\b(payroll|salary|employee)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/payroll";
    if (/\b(time|timer|pomodoro|tasks?)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/time";
    if (/\b(assistant|chat|ai)\b/.test(lower) && /\b(go|open|show|nav)\b/.test(lower))
      return "/ceo/assistant";
    if (/\b(dashboard|overview|home)\b/.test(lower)) return "/ceo";
    return null;
  }

  const isThinking = result.type === "thinking";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmd-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            className="cmd-palette"
            initial={{ opacity: 0, scale: 0.97, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -10 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
          >
            {/* Input row */}
            <div className="cmd-input-wrap">
              <span style={{ color: isThinking ? "var(--accent)" : "var(--text-dim)", fontSize: "1.1rem", flexShrink: 0 }}>
                {isThinking ? (
                  <span className="loading-spin" />
                ) : "⌘"}
              </span>
              <input
                ref={inputRef}
                className="cmd-input"
                placeholder="Ask anything or type a command…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") run(query);
                }}
                disabled={isThinking}
              />
              {query && (
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-md"
                  style={{ background: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
                  onClick={() => run(query)}
                >
                  Run ↵
                </button>
              )}
            </div>

            {/* Quick commands (shown when idle + no query) */}
            {result.type === "idle" && !query && (
              <div className="p-3 flex flex-wrap gap-2">
                {QUICK_CMDS.map((cmd) => (
                  <button
                    key={cmd.query}
                    type="button"
                    onClick={() => {
                      setQuery(cmd.query);
                      run(cmd.query);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "var(--text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ color: "var(--accent-bright)" }}>{cmd.icon}</span>
                    {cmd.label}
                  </button>
                ))}
              </div>
            )}

            {/* Results */}
            <AnimatePresence>
              {result.type !== "idle" && result.type !== "thinking" && (
                <motion.div
                  className="cmd-result"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {result.type === "text" && (
                    <p style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{result.content}</p>
                  )}
                  {result.type === "action" && (
                    <div className="flex flex-col gap-3">
                      <p style={{ color: "var(--text)" }}>{result.content}</p>
                      {result.href && (
                        <a
                          href={result.href}
                          onClick={onClose}
                          className="btn btn-primary w-fit"
                        >
                          {result.label} →
                        </a>
                      )}
                    </div>
                  )}
                  {result.type === "error" && (
                    <p style={{ color: "#f87171" }}>{result.message}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer hint */}
            <div className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="cmd-shortcut">
                <kbd>↵</kbd> run&nbsp;&nbsp;<kbd>esc</kbd> close
              </span>
              <span className="text-[0.6rem] tracking-widest uppercase" style={{ color: "var(--text-dim)" }}>
                BluRidge AI
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
