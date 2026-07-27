"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { haptic } from "@/components/mail/haptics";
import {
  addMailAccountAction,
  listMailAccountsAction,
  removeMailAccountAction,
  testMailConnectionAction,
  type MailAccountSummary,
} from "@/actions/mail-accounts";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };

type FormState = {
  address: string;
  displayName: string;
  host: string;
  imapPort: string;
  imapSecure: boolean;
  smtpPort: string;
  smtpSecure: boolean;
  username: string;
  password: string;
};

const DEFAULT_FORM: FormState = {
  address: "",
  displayName: "",
  host: "mail.thebluridge.com",
  imapPort: "993",
  imapSecure: true,
  smtpPort: "587",
  smtpSecure: false,
  username: "",
  password: "",
};

function fieldInputStyle() {
  return {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    color: "var(--text)",
  };
}

export function MailboxesPanel({
  open,
  onClose,
  accounts,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  accounts: MailAccountSummary[];
  onChange: (next: MailAccountSummary[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function startAdd() {
    setForm(DEFAULT_FORM);
    setError("");
    setTestResult(null);
    setShowForm(true);
    haptic("tap");
  }

  async function refresh() {
    const rows = await listMailAccountsAction();
    onChange(rows);
    return rows;
  }

  function runTest() {
    setTestResult(null);
    setTesting(true);
    startTransition(async () => {
      try {
        const res = await testMailConnectionAction({
          host: form.host.trim(),
          imapPort: Number(form.imapPort) || 993,
          imapSecure: form.imapSecure,
          smtpPort: Number(form.smtpPort) || 587,
          smtpSecure: form.smtpSecure,
          username: form.username.trim(),
          password: form.password,
        });
        setTestResult(
          res.ok
            ? { ok: true, message: "Connection succeeded" }
            : { ok: false, message: res.error },
        );
        haptic(res.ok ? "success" : "warn");
      } finally {
        setTesting(false);
      }
    });
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        await addMailAccountAction({
          address: form.address.trim(),
          displayName: form.displayName.trim() || undefined,
          host: form.host.trim(),
          imapPort: Number(form.imapPort) || 993,
          imapSecure: form.imapSecure,
          smtpPort: Number(form.smtpPort) || 587,
          smtpSecure: form.smtpSecure,
          username: form.username.trim(),
          password: form.password,
        });
        await refresh();
        setShowForm(false);
        haptic("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add mailbox");
        haptic("warn");
      }
    });
  }

  function remove(accountId: string, address: string) {
    if (
      !window.confirm(
        `Remove ${address}? Its synced mail, labels, and settings will be deleted from this app (the mailbox itself, on the mail server, is untouched).`,
      )
    ) {
      haptic("warn");
      return;
    }
    startTransition(async () => {
      try {
        await removeMailAccountAction(accountId);
        await refresh();
        haptic("success");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove mailbox");
        haptic("warn");
      }
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
            aria-label="Close mailboxes"
            className="absolute inset-0 cursor-pointer"
            style={{ background: "rgba(0,0,0,0.55)" }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
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
                  Mailboxes
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
                  onClick={startAdd}
                >
                  + Add mailbox
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

            <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
              {!showForm && (
                <ul className="space-y-2">
                  {accounts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm"
                      style={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium" style={{ color: "var(--text)" }}>
                          {a.displayName || a.address}
                        </div>
                        <div className="truncate text-xs" style={{ color: "var(--text-dim)" }}>
                          {a.address}
                          {a.isPrimary ? " · primary" : ""}
                        </div>
                      </div>
                      {!a.isPrimary && (
                        <button
                          type="button"
                          disabled={pending}
                          className="shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                          style={{
                            background: "rgba(239,68,68,0.12)",
                            color: "#f87171",
                            border: "1px solid rgba(239,68,68,0.3)",
                          }}
                          onClick={() => remove(a.id, a.address)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {showForm && (
                <div className="space-y-3">
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Email address
                    <input
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={fieldInputStyle()}
                      placeholder="accounts@thebluridge.com"
                      value={form.address}
                      onChange={(e) => set("address", e.target.value)}
                    />
                  </label>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Display name (optional)
                    <input
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={fieldInputStyle()}
                      placeholder="Accounts"
                      value={form.displayName}
                      onChange={(e) => set("displayName", e.target.value)}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      IMAP / SMTP host
                      <input
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={fieldInputStyle()}
                        value={form.host}
                        onChange={(e) => set("host", e.target.value)}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      Username
                      <input
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={fieldInputStyle()}
                        placeholder="Usually the same as the address"
                        value={form.username}
                        onChange={(e) => set("username", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      IMAP port
                      <input
                        type="number"
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={fieldInputStyle()}
                        value={form.imapPort}
                        onChange={(e) => set("imapPort", e.target.value)}
                      />
                    </label>
                    <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                      SMTP port
                      <input
                        type="number"
                        className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={fieldInputStyle()}
                        value={form.smtpPort}
                        onChange={(e) => set("smtpPort", e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={form.imapSecure}
                        onChange={(e) => set("imapSecure", e.target.checked)}
                      />
                      IMAP over TLS
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="cursor-pointer"
                        checked={form.smtpSecure}
                        onChange={(e) => set("smtpSecure", e.target.checked)}
                      />
                      SMTP over TLS (usually off for STARTTLS on 587)
                    </label>
                  </div>
                  <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                    Password
                    <input
                      type="password"
                      className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                      style={fieldInputStyle()}
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                    />
                  </label>

                  {testResult && (
                    <p
                      className="text-xs"
                      style={{ color: testResult.ok ? "#4ade80" : "#f87171" }}
                    >
                      {testResult.message}
                    </p>
                  )}
                  {error && (
                    <p className="text-xs" style={{ color: "#f87171" }}>
                      {error}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={testing || !form.host.trim() || !form.username.trim() || !form.password}
                      className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                      style={{
                        background: "rgba(255,255,255,0.08)",
                        color: "var(--text)",
                        border: "1px solid var(--border-strong)",
                      }}
                      onClick={runTest}
                    >
                      {testing ? "Testing…" : "Test connection"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        pending ||
                        !form.address.trim() ||
                        !form.host.trim() ||
                        !form.username.trim() ||
                        !form.password
                      }
                      className="cursor-pointer rounded-lg px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                      style={{
                        background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                        color: "#fff",
                        border: "1px solid rgba(129,140,248,0.45)",
                      }}
                      onClick={save}
                    >
                      {pending ? "Saving…" : "Save mailbox"}
                    </button>
                    <button
                      type="button"
                      className="cursor-pointer rounded-lg px-4 py-2 text-xs"
                      style={{
                        background: "transparent",
                        color: "var(--text-dim)",
                        border: "1px solid var(--border)",
                      }}
                      onClick={() => setShowForm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!showForm && !accounts.length && (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  No mailboxes yet.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
