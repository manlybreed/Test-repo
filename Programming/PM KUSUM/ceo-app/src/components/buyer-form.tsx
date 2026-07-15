"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient, updateClient } from "@/actions/clients";
import { panFromGstin, stateFromGstin } from "@/lib/indian-states";
import { UPLOAD_ACCEPT } from "@/lib/upload";
import { ConfirmModifyDialog } from "@/components/confirm-dialogs";

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
  pocName: string;
  notes: string;
};

export type ClientEditSeed = {
  id: string;
  name: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  pan?: string | null;
  email?: string | null;
  phone?: string | null;
  pocName?: string | null;
  notes?: string | null;
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
  pocName: "",
  notes: "",
};

function seedToForm(s: ClientEditSeed): BuyerFormData {
  return {
    name: s.name || "",
    addressLine1: s.addressLine1 || "",
    addressLine2: s.addressLine2 || "",
    city: s.city || "",
    state: s.state || "",
    stateCode: s.stateCode || "",
    pincode: s.pincode || "",
    gstin: s.gstin || "",
    pan: s.pan || "",
    email: s.email || "",
    phone: s.phone || "",
    pocName: s.pocName || "",
    notes: s.notes || "",
  };
}

type DocItem = {
  id: string;
  name: string;
  mime?: string;
  size: number;
  /** Base64 payload read immediately on select — File handles go stale in some browsers. */
  dataBase64?: string;
  filePath?: string;
  status: "reading" | "queued" | "uploading" | "ready" | "error";
  error?: string;
};

type Mode = "manual" | "documents";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(
        reader.error ||
          new Error(
            `Could not read ${file.name}. Re-add the file from Browse / Drop.`,
          ),
      );
    reader.readAsDataURL(file);
  });
}

function isAllowedDoc(f: File) {
  const t = (f.type || "").toLowerCase();
  const n = f.name.toLowerCase();
  if (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(t)) {
    return true;
  }
  if (!t || t === "application/octet-stream") {
    return /\.(pdf|jpe?g|png|webp)$/i.test(n);
  }
  return false;
}

export function BuyerForm({
  onCreated,
  embedded = false,
  editing = null,
  onCancelEdit,
}: {
  onCreated?: (client: {
    id: string;
    name: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    gstin: string | null;
    pan: string | null;
    phone: string | null;
    pocName: string | null;
    email: string | null;
  }) => void;
  /** When true, avoid nested <form> (e.g. inside agreement wizard). */
  embedded?: boolean;
  editing?: ClientEditSeed | null;
  onCancelEdit?: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(editing?.id);
  const [mode, setMode] = useState<Mode>(isEdit ? "manual" : "documents");
  const [form, setForm] = useState<BuyerFormData>(
    editing ? seedToForm(editing) : EMPTY,
  );
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [detected, setDetected] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [savedName, setSavedName] = useState("");
  const [confirmModify, setConfirmModify] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setForm(seedToForm(editing));
      setMode("manual");
    } else {
      setForm(EMPTY);
    }
  }, [editing]);

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
    const incoming = Array.from(fileList).filter(isAllowedDoc);
    if (!incoming.length) {
      setError("Upload JPG, PNG, WebP, or PDF only.");
      return;
    }
    setError("");

    const placeholders: DocItem[] = incoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      mime: file.type || undefined,
      size: file.size,
      status: "reading",
    }));
    setDocs((prev) => [...prev, ...placeholders]);

    // Capture bytes immediately — waiting until Extract often fails with
    // "permission problems… after a reference to a file was acquired".
    void (async () => {
      for (let i = 0; i < incoming.length; i++) {
        const file = incoming[i]!;
        const id = placeholders[i]!.id;
        try {
          const dataBase64 = await readFileAsBase64(file);
          setDocs((prev) =>
            prev.map((d) =>
              d.id === id
                ? { ...d, dataBase64, status: "queued", error: undefined }
                : d,
            ),
          );
        } catch (err) {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === id
                ? {
                    ...d,
                    status: "error",
                    error:
                      err instanceof Error
                        ? err.message
                        : "Could not read file — remove and add it again",
                  }
                : d,
            ),
          );
        }
      }
    })();
  }, []);

  async function uploadOne(item: DocItem): Promise<DocItem> {
    if (item.filePath && item.status === "ready") return item;
    if (!item.dataBase64) {
      const failed = {
        ...item,
        status: "error" as const,
        error: "File data missing — remove and add again",
      };
      setDocs((prev) => prev.map((d) => (d.id === item.id ? failed : d)));
      return failed;
    }
    setDocs((prev) =>
      prev.map((d) =>
        d.id === item.id ? { ...d, status: "uploading", error: undefined } : d,
      ),
    );
    try {
      const payload = {
        name: item.name,
        mime: item.mime,
        data: item.dataBase64,
      };
      const res = await fetch("/api/buyers/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        filePath?: string;
        error?: string;
      };
      if (!res.ok || !data.filePath) {
        const failed = {
          ...item,
          status: "error" as const,
          error: data.error || `Upload failed (${res.status})`,
        };
        setDocs((prev) => prev.map((d) => (d.id === item.id ? failed : d)));
        return failed;
      }
      const ready = {
        ...item,
        status: "ready" as const,
        filePath: data.filePath,
      };
      setDocs((prev) => prev.map((d) => (d.id === item.id ? ready : d)));
      return ready;
    } catch (err) {
      const failed = {
        ...item,
        status: "error" as const,
        error: err instanceof Error ? err.message : "Upload failed",
      };
      setDocs((prev) => prev.map((d) => (d.id === item.id ? failed : d)));
      return failed;
    }
  }

  async function extractFromDocs() {
    if (docs.length === 0) {
      setError("Add at least one document (COI, PAN, GST, etc.).");
      return;
    }
    if (docs.some((d) => d.status === "reading")) {
      setError("Still reading files — wait a moment, then try Extract again.");
      return;
    }
    const readable = docs.filter((d) => d.dataBase64 && d.status !== "error");
    if (readable.length === 0) {
      setError(
        "No readable documents. Remove the files and add them again with Browse / Drop.",
      );
      return;
    }
    setError("");
    setExtracting(true);
    try {
      const files = readable.map((d) => ({
        name: d.name,
        mime: d.mime,
        data: d.dataBase64!,
      }));
      const res = await fetch("/api/buyers/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.data) {
        setError(
          data.error ||
            `AI extraction failed (${res.status}). Fill the form manually or try again.`,
        );
        return;
      }

      void Promise.allSettled(readable.map((d) => uploadOne(d)));

      const d = data.data;
      const str = (k: string) =>
        (typeof d[k] === "string" ? (d[k] as string) : "") || "";
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
        pocName: str("pocName") || str("contactName") || str("contactPerson"),
        notes: [
          str("cin") ? `CIN: ${str("cin")}` : "",
          str("notes"),
          str("tradeName") ? `Trade: ${str("tradeName")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
      setDetected(
        Array.isArray(d.documentsDetected)
          ? (d.documentsDetected as string[])
          : [],
      );
      setConfidence(typeof d.confidence === "number" ? d.confidence : null);
      setMode("manual");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        /failed to fetch|networkerror|load failed/i.test(msg)
          ? "Could not reach the extract API. Wait a second and try again."
          : /permission|could not be read|not readable/i.test(msg)
            ? "Browser lost access to a file. Remove the docs and add them again, then Extract."
            : msg ||
              "Extraction failed. Please try again or enter details manually.",
      );
    } finally {
      setExtracting(false);
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Legal / client name is required.");
      return;
    }
    if (isEdit) {
      setConfirmModify(true);
      return;
    }
    void saveClient();
  }

  async function saveClient() {
    setConfirmModify(false);
    start(async () => {
      try {
        const payload = {
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
          pocName: form.pocName || undefined,
          notes: form.notes || undefined,
        };
        const client =
          isEdit && editing?.id
            ? await updateClient(editing.id, payload)
            : await createClient(payload);
        setSavedName(client.name);
        if (!isEdit) {
          setForm(EMPTY);
          setDocs([]);
          setDetected([]);
          setConfidence(null);
        }
        onCreated?.(client);
        onCancelEdit?.();
        router.refresh();
        setTimeout(() => setSavedName(""), 2500);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save client");
      }
    });
  }

  return (
    <div className="space-y-5">
      {isEdit && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span style={{ color: "#a5b4fc" }}>Editing {editing?.name}</span>
          {onCancelEdit && (
            <button
              type="button"
              className="btn btn-ghost text-xs py-1"
              onClick={onCancelEdit}
            >
              Cancel
            </button>
          )}
        </div>
      )}

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
                  <span className="truncate font-medium">{d.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      style={{
                        color:
                          d.status === "error"
                            ? "#f87171"
                            : "rgba(255,255,255,0.35)",
                      }}
                    >
                      {d.status === "reading"
                        ? "Reading…"
                        : d.status === "uploading"
                          ? "Uploading…"
                          : d.status === "error"
                            ? d.error
                            : `${(d.size / 1024).toFixed(0)} KB`}
                    </span>
                    <button
                      type="button"
                      className="text-[0.65rem]"
                      style={{ color: "#f87171" }}
                      onClick={() =>
                        setDocs((prev) => prev.filter((x) => x.id !== d.id))
                      }
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
            disabled={
              extracting ||
              docs.length === 0 ||
              docs.some((d) => d.status === "reading") ||
              !docs.some((d) => d.dataBase64)
            }
            onClick={extractFromDocs}
          >
            {extracting ? "Reading documents…" : "Extract with AI"}
          </button>
        </div>
      )}

      {(mode === "manual" || form.name) && (
        (() => {
          const fields = (
            <>
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
              <label className="label">Legal / client name *</label>
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
              <label className="label">PoC name</label>
              <input
                className="input"
                value={form.pocName}
                onChange={(e) => setField("pocName", e.target.value)}
                placeholder="Primary contact person"
              />
            </div>
            <div>
              <label className="label">PoC contact number</label>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder="10-digit mobile"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <input className="input" value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="CIN, SPV, remarks…" />
            </div>
          </div>

          <button
            type={embedded ? "button" : "submit"}
            className="btn btn-primary"
            disabled={pending}
            onClick={embedded ? () => submit() : undefined}
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Save client"}
          </button>
            </>
          );
          return embedded ? (
            <div className="space-y-4">{fields}</div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              {fields}
            </form>
          );
        })()
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

      <ConfirmModifyDialog
        open={confirmModify}
        title="Save client changes?"
        description={`Update ${editing?.name || "this client"}? Linked agreements keep their existing DOCX snapshots.`}
        pending={pending}
        onCancel={() => setConfirmModify(false)}
        onConfirm={() => void saveClient()}
      />
    </div>
  );
}
