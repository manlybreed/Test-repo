"use client";

import { useState, useTransition } from "react";

export function InvoiceAskPanel() {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [pending, start] = useTransition();

  function ask() {
    if (!q.trim()) return;
    start(async () => {
      setAnswer("");
      const res = await fetch("/api/invoices/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.trim() }),
      });
      const data = (await res.json()) as { answer?: string; error?: string };
      setAnswer(data.answer || data.error || "No response");
    });
  }

  return (
    <div
      className="rounded-xl p-4 mb-6 space-y-2"
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
      }}
    >
      <p
        className="text-[0.6rem] tracking-[0.15em] uppercase font-semibold"
        style={{ color: "var(--text-dim)" }}
      >
        Invoice Ask AI
      </p>
      <div className="flex gap-2">
        <input
          className="input flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Which invoices need credit notes? How does IGST apply for Rajasthan buyers under DEL?"
          onKeyDown={(e) => {
            if (e.key === "Enter") ask();
          }}
        />
        <button
          type="button"
          className="btn btn-ghost text-xs"
          disabled={pending || !q.trim()}
          onClick={ask}
        >
          {pending ? "…" : "Ask"}
        </button>
      </div>
      {answer && (
        <div
          className="text-sm whitespace-pre-wrap rounded-lg p-3"
          style={{
            background: "rgba(255,255,255,0.03)",
            color: "var(--text-muted)",
          }}
        >
          {answer}
        </div>
      )}
    </div>
  );
}
