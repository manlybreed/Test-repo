"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/actions/clients";
import { panFromGstin, stateFromGstin } from "@/lib/indian-states";
import { UPLOAD_ACCEPT } from "@/lib/upload";

export type BuyerFormData = {
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  gstin: string;
  pan: string;
  email: string;
  phone: string;
  notes: string;
};

const EMPTY: BuyerFormData = {
  name: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  stateCode: "",
  pincode: "",
  gstin: "",
  pan: "",
  email: "",
  phone: "",
  notes: "",
};

type DocItem = {
  id: string;
  file: File;
  filePath?: string;
  status: "queued" | "uploading" | "ready" | "error";
  error?: string;
};

type Mode = "manual" | "documents";

export function BuyerForm({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("documents");
  const [form, setForm] = useState<BuyerFormData>(EMPTY);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [detected, setDetected] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [savedName, setSavedName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function setField<K extends keyof BuyerFormData>(key: K, value: BuyerFormData[K]) {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "gstin") {
        const gstin = String(value).toUpperCase();
        next.gstin = gstin;
        const st = stateFromGstin(gstin);
        if (st) {
          if (!next.stateCode) next.stateCode = st.stateCode;
          if (!next.state) next.state = st.state;
        }
        const pan = panFromGstin(gstin);
        if (pan && !next.pan) next.pan = pan;
      }
      return next;
    });
  }

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) =>
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type),
    );
    if (!incoming.length) {
      setError("Upload JPG, PNG, WebP, or PDF only.");
      return;
    }
    setError("");
    setDocs((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        status: "queued" as const,
      })),
    ]);
  }, []);

  async function uploadAll(items: DocItem[]): Promise<DocItem[]> {
    const out: DocItem[] = [];
    for (const item of items) {
      if (item.filePath && item.status === "ready") {
        out.push(item);
        continue;
      }
      setDocs((prev) => prev.map((d) => (d.id === item.id ? { ...d, status: "uploading" } : d)));
      const fd = new FormData();
      fd.append("file", item.file);
      const res = await fetch("/api/buyers/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { filePath?: string; error?: string };
      if (!data.filePath) {
        const failed = { ...item, status: "error" as const, error: data.error || "Upload failed" };
        setDocs((prev) => prev.map((d) => (d.id === item.id ? failed : d)));
        out.push(failed);
        continue;
      }
      const ready = { ...item, status: "ready" as const, filePath: data.filePath };
      setDocs((prev) => prev.map((d) => (d.id === item.id ? ready : d)));
      out.push(ready);
    }
    return out;
  }

  async function extractFromDocs() {
    if (docs.length === 0) {
      setError("Add at least one document (COI, PAN, GST, etc.).");
      return;
    }
    setError("");
    setExtracting(true);
    try {
      const uploaded = await uploadAll(docs);
      const ok = uploaded.filter((d) => d.status === "ready");
      if (ok.length === 0) {
        setError("All uploads failed.");
        return;
      }

      const fd = new FormData();
      for (const d of ok) fd.append("files", d.file);
      const res = await fetch("/api/buyers/extract", { method: "POST", body: fd });
      const data = (await res.json()) as {
        ok?: boolean;
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!data.ok || !data.data) {
        setError(data.error || "AI extraction failed — fill the form manually.");
        setMode("manual");
        return;
      }

      const d = data.data;
      const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "") || "";
      setForm({
        name: str("name"),
        addressLine1: str("addressLine1"),
        addressLine2: str("addressLine2"),
        city: str("city"),
        state: str("state"),
        stateCode: str("stateCode"),
        pincode: str("pincode"),
        gstin: str("gstin").toUpperCase(),
        pan: str("pan").toUpperCase(),
        email: str("email"),
        phone: str("phone"),
        notes: [str("cin") ? `CIN: ${str("cin")}` : "", str("notes"), str("tradeName") ? `Trade: ${str("tradeName")}` : ""]
          .filter(Boolean)
          .join(" · "),
      });
      setDetected(Array.isArray(d.documentsDetected) ? (d.documentsDetected as string[]) : []);
      setConfidence(typeof d.confidence === "number" ? d.confidence : null);
      setMode("manual"); // show editable confirm form
    } catch {
      setError("Extraction failed — check connection and try again.");
    } finally {
      setExtracting(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Legal / buyer name is required.");
      return;
    }
    start(async () => {
      try {
        const client = await createClient({
          name: form.name,
          addressLine1: form.addressLine1 || undefined,
          addressLine2: form.addressLine2 || undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          stateCode: form.stateCode || undefined,
          pincode: form.pincode || undefined,
          gstin: form.gstin || undefined,
          pan: form.pan || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
          notes: form.notes || undefined,
        });
        setSavedName(client.name);
        setForm(EMPTY);
        setDocs([]);
        setDetected([]);
        setConfidence(null);
        onCreated?.();
        router.refresh();
        setTimeout(() => setSavedName(""), 2500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save buyer");
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Mode switch */}
      <div className="flex gap-2 p-1 rounded-xl w-fit" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {(
          [
            { id: "documents", label: "From documents" },
            { id: "manual", label: "Manual entry" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all"
            style={{
              background: mode === m.id ? "rgba(99,102,241,0.18)" : "transparent",
              color: mode === m.id ? "#a5b4fc" : "rgba(255,255,255,0.45)",
              border: mode === m.id ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "documents" && (
        <div className="space-y-4">
          <div
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="rounded-xl cursor-pointer flex flex-col items-center justify-center gap-2 transition-all"
            style={{
              border: "2px dashed rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.02)",
              padding: "2.25rem 1.5rem",
            }}
          >
            <p className="text-sm font-medium">Drop COI, PAN, GST & other KYC docs</p>
            <p className="text-xs text-center max-w-md" style={{ color: "rgba(255,255,255,0.4)" }}>
              Upload multiple files — AI merges legal name, address, GSTIN, PAN, state & more
            </p>
            <span className="text-xs px-3 py-1.5 rounded-lg mt-1" style={{ background: "var(--accent)", color: "#fff" }}>
              Browse files
            </span>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {docs.length > 0 && (
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <span className="truncate font-medium">{d.file.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span style={{ color: d.status === "error" ? "#f87171" : "rgba(255,255,255,0.35)" }}>
                      {d.status === "uploading" ? "Uploading…" : d.status === "error" ? d.error : `${(d.file.size / 1024).toFixed(0)} KB`}
                    </span>
                    <button
                      type="button"
                      className="text-[0.65rem]"
                      style={{ color: "#f87171" }}
                      onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={extracting || docs.length === 0}
            onClick={extractFromDocs}
          >
            {extracting ? "Reading documents…" : "Extract with AI"}
          </button>
        </div>
      )}

      {(mode === "manual" || form.name) && (
        <form onSubmit={submit} className="space-y-4">
          {(detected.length > 0 || confidence != null) && (
            <div
              className="flex flex-wrap items-center gap-2 text-[0.65rem] px-3 py-2 rounded-lg"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}
            >
              {detected.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 rounded font-bold"
                  style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}
                >
                  {t}
                </span>
              ))}
              {confidence != null && (
                <span style={{ color: "rgba(255,255,255,0.45)" }}>
                  Confidence {Math.round(confidence * 100)}% — verify before saving
                </span>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="label">Legal / buyer name *</label>
              <input className="input" required value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </div>
            <div>
              <label className="label">GSTIN</label>
              <input
                className="input font-mono"
                value={form.gstin}
                maxLength={15}
                onChange={(e) => setField("gstin", e.target.value)}
                placeholder="15-character GSTIN"
              />
            </div>
            <div>
              <label className="label">PAN</label>
              <input
                className="input font-mono"
                value={form.pan}
                maxLength={10}
                onChange={(e) => setField("pan", e.target.value.toUpperCase())}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address line 1</label>
              <input className="input" value={form.addressLine1} onChange={(e) => setField("addressLine1", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address line 2</label>
              <input className="input" value={form.addressLine2} onChange={(e) => setField("addressLine2", e.target.value)} />
            </div>
            <div>
              <label className="label">City</label>
              <input className="input" value={form.city} onChange={(e) => setField("city", e.target.value)} />
            </div>
            <div>
              <label className="label">PIN code</label>
              <input className="input" value={form.pincode} onChange={(e) => setField("pincode", e.target.value)} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={form.state} onChange={(e) => setField("state", e.target.value)} />
            </div>
            <div>
              <label className="label">State code</label>
              <input className="input" value={form.stateCode} onChange={(e) => setField("stateCode", e.target.value)} maxLength={2} />
            </div>
            <div>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="CIN, SPV, remarks…" />
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : "Save buyer"}
          </button>
        </form>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {savedName && (
        <p className="text-sm" style={{ color: "#34d399" }}>
          ✓ Saved {savedName}
        </p>
      )}
    </div>
  );
}
