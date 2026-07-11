"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

type Msg = {
  role: "user" | "assistant";
  content: string;
  downloads?: { label: string; href: string }[];
};

const SUGGESTIONS = [
  "Create a PM KUSUM agreement for BSS Eco Solar — 1 plant, ₹40,000 token",
  "Invoice BSS Eco Solar — TEV ₹1,00,000 + ROC ₹3,500, remarks SPV-SAKARWADA",
  "List all employees, then generate July 2026 salary slips for each",
  "Add task: Follow up SBI RM on Alwar plant, start a 25-min pomodoro",
];

export function AssistantChat() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "I can draft agreements from the actual PM KUSUM template, generate GST invoices, salary slips, and manage your focus sessions. What would you like to do?",
    },
  ]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError("");
    setInput("");
    setMessages((m) => [...m, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, threadId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setThreadId(data.threadId);
      setMessages((m) => [...m, { role: "assistant", content: data.reply, downloads: data.downloads }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 160px)" }}>
      {/* Suggestions */}
      <div className="flex flex-wrap gap-2 mb-4 shrink-0">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className="btn btn-ghost text-xs text-left max-w-full"
            style={{ fontSize: "0.7rem", padding: "0.3rem 0.7rem" }}
            onClick={() => void send(s)}
            disabled={loading}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0 mb-4"
        style={{ scrollbarWidth: "thin" }}
      >
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className={`max-w-[82%] ${m.role === "user" ? "" : ""}`}>
                <p
                  className="text-[0.6rem] tracking-[0.15em] uppercase mb-1.5"
                  style={{ color: "var(--text-dim)" }}
                >
                  {m.role === "user" ? "You" : "Assistant"}
                </p>
                <div
                  className="px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap rounded-md"
                  style={{
                    background: m.role === "user" ? "var(--navy-muted)" : "var(--bg-elevated)",
                    border: `1px solid ${m.role === "user" ? "var(--border-strong)" : "var(--border)"}`,
                  }}
                >
                  {m.content}
                </div>
                {m.downloads && m.downloads.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.downloads.map((d) => (
                      <a
                        key={d.href}
                        href={d.href}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-ghost text-xs"
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.3rem 0.75rem",
                          borderColor: "var(--border-strong)",
                          color: "var(--navy-bright)" ,
                        }}
                      >
                        ↓ {d.label}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div
            className="flex justify-start"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div
              className="px-4 py-3 rounded-md text-sm"
              style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
            >
              <span className="flex items-center gap-2" style={{ color: "var(--text-dim)" }}>
                <span className="loading-spin" style={{ width: 12, height: 12 }} />
                Working…
              </span>
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs px-3 py-2 rounded mb-3 shrink-0" style={{ background: "rgba(139,51,51,0.15)", border: "1px solid var(--danger)", color: "#e09090" }}>
          {error}
        </p>
      )}

      {/* Input */}
      <form onSubmit={onSubmit} className="flex gap-3 shrink-0">
        <textarea
          ref={textareaRef}
          className="input flex-1 resize-none"
          rows={2}
          placeholder="Ask to create an agreement, invoice, salary slip… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
          style={{ lineHeight: 1.5 }}
        />
        <button
          type="submit"
          className="btn btn-primary self-end"
          disabled={loading || !input.trim()}
          style={{ height: "44px", minWidth: "80px" }}
        >
          Send →
        </button>
      </form>
    </div>
  );
}
