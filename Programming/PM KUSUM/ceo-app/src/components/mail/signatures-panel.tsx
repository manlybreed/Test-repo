"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MailComposer } from "@/components/mail/composer";
import { haptic } from "@/components/mail/haptics";
import {
  deleteSignature,
  listSignatures,
  upsertSignature,
} from "@/actions/mail";

export type SignatureRow = {
  id: string;
  name: string;
  htmlBody: string;
  isDefault: boolean;
};

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

export function SignaturesPanel({
  open,
  onClose,
  signatures,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  signatures: SignatureRow[];
  onChange: (next: SignatureRow[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [html, setHtml] = useState("<p>Best regards,</p>");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState("");

  function startNew() {
    setEditId(null);
    setName("New signature");
    setHtml("<p>Best regards,<br/>Akshay<br/>BluRidge Consulting</p>");
    setIsDefault(signatures.length === 0);
    setError("");
    haptic("tap");
  }

  function startEdit(s: SignatureRow) {
    setEditId(s.id);
    setName(s.name);
    setHtml(s.htmlBody);
    setIsDefault(s.isDefault);
    setError("");
    haptic("tap");
  }

  function refresh() {
    return listSignatures().then((rows) => {
      onChange(rows as SignatureRow[]);
      return rows;
    });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Close signatures"
            className="absolute inset-0 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border-strong)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
            }}
          >
            <div
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <div>
                <p
                  className="text-[0.65rem] uppercase tracking-[0.18em]"
                  style={{ color: "var(--accent-bright)" }}
                >
                  Mail settings
                </p>
                <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
                  Signatures
                </h2>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: "var(--accent-dim)",
                    color: "var(--accent-bright)",
                    border: "1px solid rgba(99,102,241,0.35)",
                  }}
                  onClick={startNew}
                >
                  + New
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-lg px-3 py-1.5 text-xs"
                  style={{
                    background: "var(--bg-hover)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 overflow-hidden md:grid-cols-[220px_1fr]">
              <ul
                className="overflow-auto p-2"
                style={{ borderRight: "1px solid var(--border)" }}
              >
                {signatures.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="mb-1 flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm"
                      style={{
                        background:
                          editId === s.id ? "var(--accent-dim)" : "transparent",
                        color:
                          editId === s.id
                            ? "var(--accent-bright)"
                            : "var(--text-muted)",
                      }}
                      onClick={() => startEdit(s)}
                    >
                      <span className="truncate">{s.name}</span>
                      {s.isDefault && (
                        <span className="text-[0.6rem] uppercase tracking-wide">
                          Default
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {!signatures.length && (
                  <li className="px-3 py-6 text-xs" style={{ color: "var(--text-dim)" }}>
                    No signatures yet. Create one.
                  </li>
                )}
              </ul>

              <div className="min-h-0 space-y-3 overflow-auto p-4">
                {(editId !== null || name) && (
                  <>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Name
                      <input
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{
                          background: "var(--bg-elevated)",
                          border: "1px solid var(--border-strong)",
                          color: "var(--text)",
                        }}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <MailComposer
                      key={editId || "new"}
                      initialHtml={html}
                      onChange={setHtml}
                      minHeight={200}
                      placeholder="Signature HTML…"
                    />
                    <label
                      className="flex cursor-pointer items-center gap-2 text-sm"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={isDefault}
                        onChange={(e) => setIsDefault(e.target.checked)}
                      />
                      Use as default signature on new replies
                    </label>
                    {error && (
                      <p className="text-xs" style={{ color: "#f87171" }}>
                        {error}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={pending || !name.trim()}
                        className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        style={{
                          background:
                            "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                          color: "#fff",
                          border: "1px solid rgba(129,140,248,0.45)",
                        }}
                        onClick={() =>
                          startTransition(async () => {
                            try {
                              await upsertSignature({
                                id: editId || undefined,
                                name: name.trim(),
                                htmlBody: html,
                                isDefault,
                              });
                              const rows = await refresh();
                              const saved =
                                rows.find((r) => r.name === name.trim()) ||
                                rows.find((r) => r.isDefault);
                              if (saved) startEdit(saved as SignatureRow);
                              haptic("success");
                            } catch (e) {
                              setError(
                                e instanceof Error ? e.message : "Save failed",
                              );
                              haptic("warn");
                            }
                          })
                        }
                      >
                        {pending ? "Saving…" : "Save signature"}
                      </button>
                      {editId && (
                        <button
                          type="button"
                          disabled={pending}
                          className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                          style={{
                            background: "rgba(239,68,68,0.12)",
                            color: "#f87171",
                            border: "1px solid rgba(239,68,68,0.3)",
                          }}
                          onClick={() =>
                            startTransition(async () => {
                              if (!window.confirm("Delete this signature?")) {
                                haptic("warn");
                                return;
                              }
                              try {
                                await deleteSignature(editId);
                                await refresh();
                                setEditId(null);
                                setName("");
                                setHtml("<p></p>");
                                haptic("success");
                              } catch (e) {
                                setError(
                                  e instanceof Error
                                    ? e.message
                                    : "Delete failed",
                                );
                                haptic("warn");
                              }
                            })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </>
                )}
                {editId === null && !name && (
                  <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                    Select a signature to edit, or click <strong>+ New</strong>.
                    The default signature is appended when you open Reply.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
