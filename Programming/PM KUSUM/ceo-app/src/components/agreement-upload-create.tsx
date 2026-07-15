"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgreementFromUpload } from "@/actions/agreements";
import { BuyerForm } from "@/components/buyer-form";

type ClientOption = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  pan: string | null;
  phone?: string | null;
  pocName?: string | null;
  email?: string | null;
};

const ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgreementUploadCreate({
  clients: initialClients,
  initialClientId,
}: {
  clients: ClientOption[];
  initialClientId?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [clients, setClients] = useState(initialClients);
  const [clientId, setClientId] = useState(initialClientId || "");
  const [clientName, setClientName] = useState(() => {
    const c = initialClients.find((x) => x.id === initialClientId);
    return c?.name || "";
  });
  const [spvName, setSpvName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [status, setStatus] = useState<"DRAFT" | "FINAL">("FINAL");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const selected = useMemo(
    () => clients.find((c) => c.id === clientId) || null,
    [clients, clientId],
  );

  function onClientChange(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (c) setClientName(c.name);
  }

  function pickFile(next: File | null) {
    setError("");
    if (!next) {
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const ext = (next.name.split(".").pop() || "").toLowerCase();
    if (!["pdf", "doc", "docx"].includes(ext)) {
      setError("Upload a PDF or Word file (.pdf, .docx, .doc)");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (next.size > 20 * 1024 * 1024) {
      setError("File too large (max 20 MB)");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setFile(next);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientName.trim()) {
      setError("Client name is required");
      return;
    }
    if (!file) {
      setError("Choose a PDF or Word agreement file");
      return;
    }
    start(async () => {
      try {
        const fd = new FormData();
        if (clientId) fd.set("clientId", clientId);
        fd.set("clientName", clientName.trim());
        fd.set("spvName", spvName);
        fd.set("effectiveDate", effectiveDate);
        fd.set("status", status);
        fd.set("file", file);
        const res = await createAgreementFromUpload(fd);
        router.push(`/ceo/agreements?created=${res.id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-5"
      style={{ cursor: pending ? "wait" : undefined }}
      aria-busy={pending}
    >
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Attach an already signed or external agreement. AI will infer token and
        success fees from the file; if several values appear, the average is used
        and a note is saved. No template generation — the uploaded file becomes
        the library document.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <label className="label !mb-0">Saved client</label>
            <button
              type="button"
              className="text-[0.7rem] font-semibold underline cursor-pointer"
              style={{ color: "#a5b4fc" }}
              disabled={pending}
              onClick={() => setShowNewClient((v) => !v)}
            >
              {showNewClient ? "Cancel" : "+ Add new client"}
            </button>
          </div>
          <select
            className="input"
            value={clientId}
            disabled={showNewClient || pending}
            onChange={(e) => onClientChange(e.target.value)}
          >
            <option value="">— Manual entry —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Effective date</label>
          <input
            className="input"
            type="date"
            value={effectiveDate}
            disabled={pending}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </div>
      </div>

      {showNewClient && !pending && (
        <div
          className="rounded-xl p-4"
          style={{
            background: "rgba(99,102,241,0.06)",
            border: "1px solid rgba(99,102,241,0.2)",
          }}
        >
          <p className="text-sm font-semibold mb-3">Add new client</p>
          <BuyerForm
            embedded
            onCreated={(client) => {
              setClients((prev) => {
                if (prev.some((c) => c.id === client.id)) return prev;
                return [...prev, client].sort((a, b) =>
                  a.name.localeCompare(b.name),
                );
              });
              setClientId(client.id);
              setClientName(client.name);
              setShowNewClient(false);
            }}
          />
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">
            Client / company legal name{" "}
            <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            className="input"
            required
            value={clientName}
            disabled={pending}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Legal name on the agreement"
          />
        </div>
        <div>
          <label className="label">SPV / project entity</label>
          <input
            className="input"
            value={spvName}
            disabled={pending}
            onChange={(e) => setSpvName(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value as "DRAFT" | "FINAL")}
          >
            <option value="FINAL">Final</option>
            <option value="DRAFT">Draft</option>
          </select>
        </div>
      </div>

      <div>
        <label className="label">
          Agreement file <span style={{ color: "var(--danger)" }}>*</span>
        </label>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={pending}
          onChange={(e) => pickFile(e.target.files?.[0] || null)}
        />
        <div
          role="button"
          tabIndex={pending ? -1 : 0}
          aria-disabled={pending}
          onKeyDown={(e) => {
            if (pending) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onClick={() => {
            if (!pending) fileRef.current?.click();
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (pending) return;
            pickFile(e.dataTransfer.files?.[0] || null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!pending) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl px-4 py-4 transition-all select-none"
          style={{
            border: `1.5px dashed ${
              dragOver ? "#818cf8" : "rgba(255,255,255,0.14)"
            }`,
            background: dragOver
              ? "rgba(99,102,241,0.08)"
              : "rgba(255,255,255,0.02)",
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.65 : 1,
          }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            {file ? (
              <>
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                  {formatSize(file.size)} · click or drop to replace
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  Drop agreement here or click to browse
                </p>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                  PDF or Word · max 20 MB
                </p>
              </>
            )}
          </div>
          {file && !pending && (
            <button
              type="button"
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer shrink-0"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(248,113,113,0.28)",
                color: "#fca5a5",
              }}
              onClick={(e) => {
                e.stopPropagation();
                pickFile(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {selected?.pocName && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          PoC on file:{" "}
          <span className="font-medium" style={{ color: "var(--text)" }}>
            {selected.pocName}
          </span>
          {selected.phone ? ` · ${selected.phone}` : ""}
        </p>
      )}

      {pending && (
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs"
          style={{
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(129,140,248,0.28)",
            color: "#c7d2fe",
          }}
        >
          <span
            className="inline-block w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin shrink-0"
            style={{ borderColor: "#818cf8", borderTopColor: "transparent" }}
          />
          Uploading and inferring fees — this can take a moment for large PDFs.
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !file}
          style={{ cursor: pending ? "wait" : !file ? "not-allowed" : "pointer" }}
        >
          {pending ? "Reading fees & uploading…" : "Upload agreement"}
        </button>
      </div>
    </form>
  );
}
