"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, usePathname } from "next/navigation";
import { listCommands, matchCommand, type CommandContext } from "@/lib/commands/registry";
import { invokeCommand } from "@/lib/commands/use-register-commands";
import { ConfirmationCard, type PendingAction } from "@/components/confirmation-card";
import { OptionsChips, type OptionsPrompt } from "@/components/options-chips";

type ResultState =
  | { type: "idle" }
  | { type: "thinking" }
  | { type: "text"; content: string; downloads?: { label: string; href: string }[]; optionsPrompt?: OptionsPrompt }
  | { type: "confirm"; content: string; action: PendingAction }
  | { type: "error"; message: string };

const QUICK_CMDS = [
  { label: "New Agreement", icon: "◈", query: "create new agreement" },
  { label: "Add Plant",     icon: "▣", query: "open pm kusum projects" },
  { label: "New Invoice",   icon: "◇", query: "create new invoice" },
  { label: "Add Employee",  icon: "◉", query: "add new employee" },
  { label: "Start Timer",   icon: "◎", query: "start pomodoro timer" },
  { label: "Go to Assistant", icon: "✦", query: "open ai assistant" },
];

export function CommandBar({
  open,
  onClose,
  initialQuery,
}: {
  open: boolean;
  onClose: () => void;
  /** Pre-fills and immediately runs a query when the bar opens — used by
   * the global voice entry point (ceo-shell.tsx) to hand off an utterance
   * that didn't match a registered command, so it resolves through this
   * exact same /api/command path a typed query would. */
  initialQuery?: string;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ResultState>({ type: "idle" });
  const [confirmBusy, setConfirmBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    if (initialQuery) {
      setQuery(initialQuery);
      setResult({ type: "idle" });
      run(initialQuery);
      return;
    }
    setQuery("");
    setResult({ type: "idle" });
    setTimeout(() => inputRef.current?.focus(), 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialQuery]);

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

    // Tier 1: the same fuzzy-matched shared command registry voice input
    // uses (src/lib/commands/registry.ts) — whatever page is mounted (e.g.
    // Mail) may have registered real actions here, so a typed command gets
    // the identical fast path a spoken one does before falling back to
    // nav-intent/LLM resolution below.
    const ctx: CommandContext = { route: pathname };
    const match = matchCommand(trimmed, ctx);
    if (match) {
      onClose();
      invokeCommand(match.entry.id, match.args);
      return;
    }

    // Fast client-side navigation shortcuts
    const nav = detectNavIntent(trimmed);
    if (nav) {
      onClose();
      router.push(nav);
      return;
    }

    setResult({ type: "thinking" });

    try {
      // Tier 2 fallback: hand the model the same commands Tier 1 just
      // failed to fuzzy-match, so it can catch an odd phrasing Tier 1
      // missed via a real client_action tool call instead of guessing.
      const availableCommands = listCommands(ctx).map((c) => ({
        id: c.id,
        description: c.description,
      }));
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed, availableCommands }),
      });
      const data = await res.json() as {
        type: string;
        content?: string;
        href?: string;
        error?: string;
        downloads?: { label: string; href: string }[];
        pendingConfirmation?: { toolName: string; toolInput: Record<string, unknown>; summary: string };
        optionsPrompt?: OptionsPrompt;
        commandId?: string;
        args?: Record<string, unknown> | null;
      };

      if (data.type === "navigate" && data.href) {
        onClose();
        router.push(data.href);
        return;
      }
      if (data.type === "client_action" && data.commandId) {
        onClose();
        invokeCommand(data.commandId, data.args ?? null);
        return;
      }
      if (data.type === "confirm" && data.pendingConfirmation) {
        setResult({
          type: "confirm",
          content: data.content || "",
          action: { ...data.pendingConfirmation },
        });
        return;
      }
      if (data.type === "error") {
        setResult({ type: "error", message: data.error || "Something went wrong" });
        return;
      }
      setResult({
        type: "text",
        content: data.content || "",
        downloads: data.downloads,
        optionsPrompt: data.optionsPrompt,
      });
    } catch {
      setResult({ type: "error", message: "Network error — is the server running?" });
    }
  }

  /** Only fires on a real click — the one place an irreversible tool call
   * from the ⌘K bar actually executes (mirrors assistant-chat.tsx). */
  async function handleConfirm() {
    if (result.type !== "confirm" || result.action.resolved) return;
    const action = result.action;
    setConfirmBusy(true);
    try {
      const res = await fetch("/api/ai/confirm-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName: action.toolName, toolInput: action.toolInput }),
      });
      const data = await res.json();
      setResult({
        type: "text",
        content: res.ok ? data.reply : data.error || "Confirm failed",
        downloads: data.downloads,
      });
    } catch {
      setResult({ type: "error", message: "Network error — is the server running?" });
    } finally {
      setConfirmBusy(false);
    }
  }

  function handleCancel() {
    if (result.type !== "confirm") return;
    setResult({ type: "text", content: "Cancelled." });
  }

  function detectNavIntent(q: string): string | null {
    const lower = q.toLowerCase();
    if (/\b(agreement|agreements)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower)) {
      // Owner-only route — skip auto-nav for everyone from this shortcut
      return null;
    }
    if (/\b(project|projects|plant|kusum)\b/.test(lower) && /\b(go|open|show|list|view|nav|add)\b/.test(lower))
      return "/ceo/projects";
    if (/\b(financing|finance|funding)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/financing";
    if (/\b(invoice|invoices)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/invoices";
    if (/\b(ledger|ledgers)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/ledgers";
    if (/\b(payroll|salary)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/payroll";
    if (/\b(employee|employees|staff)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/employees";
    if (/\b(client|clients|buyer|buyers)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/clients";
    if (/\b(time|timer|pomodoro|tasks?)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/time";
    if (/\b(assistant|chat|ai)\b/.test(lower) && /\b(go|open|show|nav)\b/.test(lower))
      return "/ceo/assistant";
    if (/\b(mail|email|inbox)\b/.test(lower) && /\b(go|open|show|list|view|nav)\b/.test(lower))
      return "/ceo/mail";
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
                    <div>
                      <p style={{ color: "var(--text)", whiteSpace: "pre-wrap" }}>{result.content}</p>
                      {result.downloads && result.downloads.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {result.downloads.map((d) => (
                            <a
                              key={d.href}
                              href={d.href}
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-ghost text-xs"
                              style={{ fontSize: "0.7rem", padding: "0.3rem 0.75rem" }}
                            >
                              ↓ {d.label}
                            </a>
                          ))}
                        </div>
                      )}
                      {result.optionsPrompt && (
                        <OptionsChips
                          prompt={result.optionsPrompt}
                          onPick={(value) => {
                            setQuery(value);
                            run(value);
                          }}
                        />
                      )}
                    </div>
                  )}
                  {result.type === "confirm" && (
                    <div>
                      <p style={{ color: "var(--text)" }}>{result.content}</p>
                      <ConfirmationCard
                        action={result.action}
                        pending={confirmBusy}
                        onConfirm={() => void handleConfirm()}
                        onCancel={handleCancel}
                      />
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
