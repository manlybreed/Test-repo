"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What red flags do we have on this plant?",
  "Do khasras match across jamabandi, PPA, and lease?",
  "Are GST and MCA directors the same?",
  "Summarize CIBIL status for each director",
  "What is capacity, tehsil, district, and tariff?",
];

export function PlantAssistant({
  plantId,
  plantName,
}: {
  plantId: string;
  plantName: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content: `Ask me anything about **${plantName}** — red flags (CIBIL, khasra mismatches, GST vs MCA), extracts, capacity/location, or what’s still missing.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content: `Ask me anything about **${plantName}** — red flags (CIBIL, khasra mismatches, GST vs MCA), extracts, capacity/location, or what’s still missing.`,
      },
    ]);
    setInput("");
    setError("");
  }, [plantId, plantName]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError("");
    setInput("");
    const nextHistory = [...messages, { role: "user" as const, content: trimmed }];
    setMessages(nextHistory);
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${plantId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: nextHistory
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(0, -1)
            .slice(-10),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Request failed");
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply || "No answer." },
      ]);
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

  return (
    <div className="flex flex-col h-full min-h-[320px]">
      <div className="flex flex-wrap gap-2 mb-3 shrink-0">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={loading}
            onClick={() => void send(s)}
            className="text-[0.7rem] px-2.5 py-1 rounded-lg text-left disabled:opacity-40"
            style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.28)",
              color: "#c7d2fe",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div
        className="flex-1 overflow-y-auto rounded-xl p-3 space-y-3 mb-3"
        style={{
          background: "rgba(0,0,0,0.2)",
          border: "1px solid var(--border)",
          minHeight: 200,
          maxHeight: 420,
        }}
      >
        {messages.map((m, i) => (
          <div
            key={`${m.role}-${i}`}
            className="text-xs leading-relaxed whitespace-pre-wrap"
            style={{
              color: m.role === "assistant" ? "var(--text-muted)" : "#e2e8f0",
              paddingLeft: m.role === "user" ? "1rem" : 0,
            }}
          >
            <span
              className="text-[0.6rem] uppercase tracking-wider font-semibold block mb-1"
              style={{ color: "var(--text-dim)" }}
            >
              {m.role === "assistant" ? "Plant assistant" : "You"}
            </span>
            {m.content.replace(/\*\*/g, "")}
          </div>
        ))}
        {loading && (
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Thinking about this plant…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="text-xs mb-2" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="flex gap-2 shrink-0">
        <input
          className="input text-xs flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${plantName.slice(0, 40)}…`}
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="btn btn-primary text-xs px-3 disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
