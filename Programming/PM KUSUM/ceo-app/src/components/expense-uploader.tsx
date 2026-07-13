"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { checkExpenseDuplicate, createExpense } from "@/actions/expenses";
import {
  resolveBilledTo,
  confirmBilledToSame,
  createBilledToParty,
  type BilledToCandidate,
  type ResolveBilledToResult,
} from "@/actions/billed-to";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { GstEntitySelect } from "@/components/gst-entity-select";
import type { GstEntity } from "@/lib/gst-entities";
import { GST_ENTITIES } from "@/lib/gst-entities";
import { UPLOAD_ACCEPT } from "@/lib/upload";

type Extracted = {
  vendor?: string;
  amount?: number;
  date?: string;
  invoiceNo?: string;
  description?: string;
  gstAmount?: number;
  paymentMode?: string;
  category?: string;
  billedTo?: string;
  ourGstMentioned?: boolean;
  billedGstin?: string;
  gstEntity?: GstEntity | string | null;
  confidence?: number;
  needsReview?: boolean;
};

type FormState = Extracted & {
  notes?: string;
  gstEntity?: GstEntity;
  billedToPartyId?: string | null;
  billedToCanonical?: string | null;
};

type Stage =
  | "idle"
  | "uploading"
  | "extracting"
  | "billed_confirm"
  | "confirm"
  | "saving"
  | "done";

export function ExpenseUploader({
  onSaved,
}: {
  /** Called after each successful save. `hasMore` is true when more files remain in the queue. */
  onSaved: (meta?: { hasMore: boolean }) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [extracted, setExtracted] = useState<Extracted>({});
  const [filePath, setFilePath] = useState("");
  const [contentHash, setContentHash] = useState("");
  const [form, setForm] = useState<FormState>({});
  const [error, setError] = useState("");
  const [dupWarning, setDupWarning] = useState("");
  const [forceDup, setForceDup] = useState(false);
  const [billedAmbiguous, setBilledAmbiguous] = useState<{
    incoming: string;
    candidates: BilledToCandidate[];
  } | null>(null);
  const [queuePos, setQueuePos] = useState({ index: 0, total: 0 });

  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const queueRef = useRef<File[]>([]);

  const set = (k: string, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  function clearCurrentItem() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPreview(null);
    setFileName("");
    setFilePath("");
    setContentHash("");
    setExtracted({});
    setForm({});
    setDupWarning("");
    setForceDup(false);
    setBilledAmbiguous(null);
    setError("");
  }

  function resetAll() {
    cancelledRef.current = false;
    queueRef.current = [];
    setQueuePos({ index: 0, total: 0 });
    clearCurrentItem();
    setStage("idle");
  }

  function cancelInference() {
    cancelledRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    queueRef.current = [];
    setQueuePos({ index: 0, total: 0 });
    clearCurrentItem();
    setStage("idle");
    setError("AI inference cancelled.");
  }

  async function applyBilledToResolution(
    billedTo: string,
    baseForm: FormState,
  ): Promise<"ok" | "ask" | "cancelled"> {
    if (cancelledRef.current) return "cancelled";
    if (!billedTo.trim()) {
      setForm({ ...baseForm, billedTo: "", billedToPartyId: null, billedToCanonical: null });
      return "ok";
    }

    const resolved: ResolveBilledToResult = await resolveBilledTo(billedTo);
    if (cancelledRef.current) return "cancelled";

    if (resolved.status === "matched") {
      setForm({
        ...baseForm,
        billedTo,
        billedToPartyId: resolved.partyId,
        billedToCanonical: resolved.canonicalName,
      });
      return "ok";
    }

    if (resolved.status === "ambiguous") {
      setForm({ ...baseForm, billedTo });
      setBilledAmbiguous({
        incoming: resolved.incoming,
        candidates: resolved.candidates,
      });
      return "ask";
    }

    setForm({
      ...baseForm,
      billedTo,
      billedToPartyId: null,
      billedToCanonical: null,
    });
    return "ok";
  }

  const processFile = useCallback(async (file: File) => {
    if (!file) return;
    cancelledRef.current = false;
    setError("");
    setDupWarning("");
    setForceDup(false);
    setBilledAmbiguous(null);
    setFileName(file.name);

    if (file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      setStage("uploading");
      const upFd = new FormData();
      upFd.append("file", file);
      const upRes = await fetch("/api/expenses/upload", {
        method: "POST",
        body: upFd,
        signal: ac.signal,
      });
      if (cancelledRef.current) return;
      const upData = (await upRes.json()) as {
        filePath?: string;
        contentHash?: string;
        error?: string;
      };
      if (!upData.filePath) {
        setError(upData.error || "Upload failed.");
        setStage("confirm");
        return;
      }
      setFilePath(upData.filePath);
      setContentHash(upData.contentHash || "");

      setStage("extracting");
      const exFd = new FormData();
      exFd.append("file", file);
      const exRes = await fetch("/api/expenses/extract", {
        method: "POST",
        body: exFd,
        signal: ac.signal,
      });
      if (cancelledRef.current) return;
      const exData = (await exRes.json()) as {
        ok?: boolean;
        data?: Extracted;
        error?: string;
      };
      if (!exData.ok || !exData.data) {
        setError(exData.error || "Extraction failed — please fill manually.");
      }

      const d = exData.data || {};
      const gstOnBill =
        d.ourGstMentioned === true &&
        (d.gstEntity === "RAJ" || d.gstEntity === "DEL")
          ? (d.gstEntity as GstEntity)
          : undefined;
      const billedGstin =
        d.ourGstMentioned === true
          ? d.billedGstin || (gstOnBill ? GST_ENTITIES[gstOnBill].gstin : "")
          : "";

      setExtracted(d);
      const baseForm: FormState = {
        vendor: d.vendor || "",
        amount: d.amount,
        date: d.date || new Date().toISOString().split("T")[0],
        invoiceNo: d.invoiceNo || "",
        description: d.description || "",
        gstAmount: d.gstAmount,
        paymentMode: d.paymentMode || "",
        category: d.category || "misc",
        billedTo: d.billedTo || "",
        ourGstMentioned: d.ourGstMentioned === true,
        billedGstin,
        notes:
          typeof (d as { gstCheckNote?: string }).gstCheckNote === "string"
            ? (d as { gstCheckNote?: string }).gstCheckNote || ""
            : "",
        gstEntity: gstOnBill,
      };

      try {
        const { duplicates } = await checkExpenseDuplicate({
          invoiceNo: d.invoiceNo || undefined,
          contentHash: upData.contentHash,
        });
        if (duplicates.length) {
          const top = duplicates[0];
          setDupWarning(
            top.reason === "file_hash"
              ? `This exact file was already uploaded (${top.vendor}, ₹${top.amount} on ${top.date}).`
              : `Invoice #${top.invoiceNo || "—"} already saved (${top.vendor}, ₹${top.amount} on ${top.date}).`,
          );
        }
      } catch {
        /* non-blocking */
      }

      const billedResult = await applyBilledToResolution(d.billedTo || "", baseForm);
      if (billedResult === "cancelled") return;
      if (billedResult === "ask") {
        setStage("billed_confirm");
        return;
      }
      setStage("confirm");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStage("confirm");
    } finally {
      abortRef.current = null;
    }
  }, []);

  function enqueueFiles(files: FileList | File[]) {
    const list = Array.from(files).filter(Boolean);
    if (!list.length) return;

    const busy =
      stage === "uploading" ||
      stage === "extracting" ||
      stage === "billed_confirm" ||
      stage === "confirm" ||
      stage === "saving";

    if (busy) {
      queueRef.current = [...queueRef.current, ...list];
      setQueuePos((m) => ({
        index: m.index || 1,
        total: (m.total || 1) + list.length,
      }));
      return;
    }

    queueRef.current = list.slice(1);
    setQueuePos({ index: 1, total: list.length });
    void processFile(list[0]);
  }

  function advanceToNext(saved: boolean) {
    const remaining = queueRef.current.length;
    if (remaining > 0) {
      if (saved) onSaved({ hasMore: true });
      const next = queueRef.current.shift()!;
      setQueuePos((m) => ({ ...m, index: Math.min(m.index + 1, m.total) }));
      clearCurrentItem();
      void processFile(next);
      return;
    }

    if (saved) {
      setStage("done");
      setTimeout(() => {
        resetAll();
        onSaved({ hasMore: false });
      }, 1200);
    } else {
      resetAll();
    }
  }

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files?.length) enqueueFiles(e.dataTransfer.files);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, processFile],
  );

  async function onConfirmSame(candidate: BilledToCandidate) {
    const raw = form.billedTo || billedAmbiguous?.incoming || "";
    try {
      const { partyId, canonicalName } = await confirmBilledToSame({
        partyId: candidate.partyId,
        rawName: raw,
      });
      setForm((f) => ({
        ...f,
        billedTo: raw,
        billedToPartyId: partyId,
        billedToCanonical: canonicalName,
      }));
      setBilledAmbiguous(null);
      setStage("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link billed-to");
    }
  }

  async function onConfirmDifferent() {
    const raw = form.billedTo || billedAmbiguous?.incoming || "";
    try {
      if (raw.trim()) {
        const { partyId, canonicalName } = await createBilledToParty(raw);
        setForm((f) => ({
          ...f,
          billedTo: raw,
          billedToPartyId: partyId,
          billedToCanonical: canonicalName,
        }));
      }
      setBilledAmbiguous(null);
      setStage("confirm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create billed-to party");
    }
  }

  async function save() {
    if (!form.vendor || !form.amount || !form.date || !form.category) {
      setError("Vendor, amount, date and category are required.");
      return;
    }
    setStage("saving");
    setError("");
    try {
      if (!forceDup) {
        const { duplicates } = await checkExpenseDuplicate({
          invoiceNo: form.invoiceNo || undefined,
          contentHash: contentHash || undefined,
        });
        if (duplicates.length) {
          const top = duplicates[0];
          setDupWarning(
            top.reason === "file_hash"
              ? `This exact file was already uploaded (${top.vendor}, ₹${top.amount} on ${top.date}).`
              : `Invoice #${top.invoiceNo || "—"} already saved (${top.vendor}, ₹${top.amount} on ${top.date}).`,
          );
          setError("Duplicate detected — discard, or confirm save as new.");
          setStage("confirm");
          return;
        }
      }

      await createExpense({
        vendor: form.vendor!,
        amount: Number(form.amount),
        date: form.date!,
        category: form.category!,
        description: form.description,
        paymentMode: form.paymentMode,
        gstAmount: form.gstAmount ? Number(form.gstAmount) : undefined,
        gstEntity: form.ourGstMentioned
          ? form.gstEntity || undefined
          : form.gstEntity || null,
        invoiceNo: form.invoiceNo,
        billedTo: form.billedTo,
        billedToPartyId: form.billedToPartyId,
        ourGstMentioned: Boolean(form.ourGstMentioned),
        billedGstin: form.ourGstMentioned ? form.billedGstin : null,
        contentHash: contentHash || undefined,
        filePath,
        rawExtract: JSON.stringify(extracted),
        notes: form.notes,
        needsReview: extracted.needsReview ?? false,
        forceDuplicate: forceDup,
      });
      advanceToNext(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed — try again.");
      setStage("confirm");
    }
  }

  function skipCurrent() {
    abortRef.current?.abort();
    advanceToNext(false);
  }

  const cat = EXPENSE_CATEGORIES.find((c) => c.id === form.category) ?? EXPENSE_CATEGORIES[0];
  const confidence = extracted.confidence ?? 0;
  const needsReview = extracted.needsReview || confidence < 0.7;
  const queueLabel =
    queuePos.total > 1 ? `Bill ${queuePos.index} of ${queuePos.total}` : null;
  const remainingAfter = Math.max(0, queuePos.total - queuePos.index);

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) enqueueFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {queueLabel && stage !== "idle" && stage !== "done" && (
        <div
          className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg text-xs"
          style={{
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.25)",
            color: "#a5b4fc",
          }}
        >
          <span className="font-medium">{queueLabel}</span>
          <span style={{ color: "var(--text-dim)" }}>
            {remainingAfter > 0
              ? `${remainingAfter} more after this`
              : "Last in queue"}
          </span>
        </div>
      )}

      <AnimatePresence mode="wait">
        {stage === "idle" && (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {error && (
              <p
                className="text-xs mb-3 px-3 py-2 rounded-lg"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#fca5a5",
                }}
              >
                {error}
              </p>
            )}
            <div
              onDrop={onDrop}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              className="relative flex flex-col items-center justify-center gap-3 rounded-xl cursor-pointer transition-all"
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : "rgba(255,255,255,0.1)"}`,
                background: dragOver ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)",
                padding: "3rem 2rem",
              }}
            >
              <div className="text-center">
                <p className="text-sm font-medium">Drop bills or invoices here</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                  Multiple files OK · JPG, PNG, HEIC, PDF
                </p>
              </div>
              <span
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                Browse files
              </span>
            </div>
            <button
              type="button"
              className="text-xs mt-3 underline"
              style={{ color: "var(--text-dim)" }}
              onClick={() => {
                setQueuePos({ index: 0, total: 0 });
                setForm({
                  date: new Date().toISOString().split("T")[0],
                  category: "misc",
                  ourGstMentioned: false,
                  gstEntity: undefined,
                });
                setStage("confirm");
              }}
            >
              + Enter expense manually
            </button>
          </motion.div>
        )}

        {(stage === "uploading" || stage === "extracting") && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 py-10"
          >
            <p className="text-sm font-medium">
              {stage === "uploading" ? "Uploading bill…" : "Claude is reading your bill…"}
            </p>
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              {fileName}
            </p>
            <button
              type="button"
              onClick={cancelInference}
              className="text-xs px-3 py-1.5 rounded-lg mt-2"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#fca5a5",
              }}
            >
              Cancel all
            </button>
          </motion.div>
        )}

        {stage === "billed_confirm" && billedAmbiguous && (
          <motion.div
            key="billed"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4 rounded-xl p-4"
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.35)",
            }}
          >
            <p className="text-sm font-semibold" style={{ color: "#fbbf24" }}>
              Are these the same billed-to party?
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Extracted:{" "}
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {billedAmbiguous.incoming}
              </span>
            </p>
            <div className="space-y-2">
              {billedAmbiguous.candidates.map((c) => (
                <div
                  key={c.partyId}
                  className="flex items-center justify-between gap-3 rounded-lg p-3"
                  style={{ background: "rgba(0,0,0,0.2)", border: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{c.canonicalName}</p>
                    <p className="text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
                      vs “{c.sampleAlias}” · {c.reason}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onConfirmSame(c)}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{
                      background: "rgba(16,185,129,0.15)",
                      border: "1px solid rgba(16,185,129,0.35)",
                      color: "#34d399",
                    }}
                  >
                    Yes, same
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => void onConfirmDifferent()}
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{
                  background: "rgba(99,102,241,0.15)",
                  border: "1px solid rgba(99,102,241,0.35)",
                  color: "#a5b4fc",
                }}
              >
                No — create new party
              </button>
              <button
                type="button"
                onClick={cancelInference}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: "#fca5a5" }}
              >
                Cancel all
              </button>
            </div>
          </motion.div>
        )}

        {stage === "confirm" && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            <div className="flex items-start gap-4">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt="Bill preview"
                  className="w-20 h-20 object-cover rounded-lg shrink-0"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                />
              )}
              <div className="flex-1">
                <p className="text-sm font-semibold">{fileName || "Manual entry"}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                  {needsReview
                    ? "Please verify billed-to, GST and amounts."
                    : "Verify details and save."}
                </p>
              </div>
            </div>

            {form.billedToCanonical && (
              <p
                className="text-xs px-3 py-2 rounded-lg"
                style={{
                  background: "rgba(16,185,129,0.08)",
                  border: "1px solid rgba(16,185,129,0.25)",
                  color: "#34d399",
                }}
              >
                Billed-to classified as <strong>{form.billedToCanonical}</strong>
                {form.billedTo && form.billedTo !== form.billedToCanonical
                  ? ` (from “${form.billedTo}”)`
                  : ""}
              </p>
            )}

            {dupWarning && (
              <div
                className="rounded-lg p-3 text-xs space-y-2"
                style={{
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "#fbbf24",
                }}
              >
                <p className="font-semibold">Possible duplicate</p>
                <p>{dupWarning}</p>
                <label
                  className="flex items-center gap-2 cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                >
                  <input
                    type="checkbox"
                    checked={forceDup}
                    onChange={(e) => setForceDup(e.target.checked)}
                  />
                  Save anyway (different expense with same invoice / file)
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Vendor / Merchant *</label>
                <input
                  className="input"
                  value={form.vendor || ""}
                  onChange={(e) => set("vendor", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Amount (₹) *</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={form.amount ?? ""}
                  onChange={(e) => set("amount", parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="label">Date *</label>
                <input
                  className="input"
                  type="date"
                  value={form.date || ""}
                  onChange={(e) => set("date", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Invoice / Receipt No.</label>
                <input
                  className="input"
                  value={form.invoiceNo || ""}
                  onChange={(e) => set("invoiceNo", e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="label">Billed to</label>
                <input
                  className="input"
                  value={form.billedTo || ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      billedTo: e.target.value,
                      billedToPartyId: null,
                      billedToCanonical: null,
                    }))
                  }
                  placeholder="Bill-to / buyer name on the invoice"
                />
              </div>
              <div>
                <label className="label">Our GST on bill?</label>
                <select
                  className="input"
                  value={form.ourGstMentioned ? "yes" : "no"}
                  onChange={(e) => {
                    const yes = e.target.value === "yes";
                    setForm((f) => ({
                      ...f,
                      ourGstMentioned: yes,
                      ...(yes ? {} : { billedGstin: "", gstEntity: undefined }),
                    }));
                  }}
                >
                  <option value="no">No — company name only / not mentioned</option>
                  <option value="yes">Yes — BluRidge GSTIN printed</option>
                </select>
              </div>
              <div>
                <label className="label">BluRidge GSTIN (if found)</label>
                <input
                  className="input"
                  value={form.billedGstin || ""}
                  onChange={(e) => set("billedGstin", e.target.value)}
                  disabled={!form.ourGstMentioned}
                  placeholder={form.ourGstMentioned ? "07… / 08…" : "Not on bill"}
                />
              </div>
              <div>
                <label className="label">GST Amount (₹)</label>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={form.gstAmount ?? ""}
                  onChange={(e) => set("gstAmount", parseFloat(e.target.value))}
                />
              </div>
              <div>
                <label className="label">Payment Mode</label>
                <select
                  className="input"
                  value={form.paymentMode || ""}
                  onChange={(e) => set("paymentMode", e.target.value)}
                >
                  <option value="">— select —</option>
                  {["UPI", "Cash", "Card", "Net Banking", "NEFT", "IMPS", "Cheque"].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                {form.ourGstMentioned ? (
                  <GstEntitySelect
                    label="Which BluRidge GST (on bill / booked under)"
                    value={form.gstEntity || "DEL"}
                    onChange={(v) => set("gstEntity", v)}
                  />
                ) : (
                  <div>
                    <label className="label">BluRidge GST on bill</label>
                    <p
                      className="text-sm mt-1 px-3 py-2.5 rounded-lg"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "var(--text-muted)",
                      }}
                    >
                      Not mentioned — only company name (or neither) on this bill.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="label">Description</label>
              <input
                className="input"
                value={form.description || ""}
                onChange={(e) => set("description", e.target.value)}
              />
            </div>

            <div>
              <label className="label">Category *</label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-1">
                {EXPENSE_CATEGORIES.map((c) => {
                  const selected = form.category === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => set("category", c.id)}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all"
                      style={{
                        background: selected ? c.bg : "rgba(255,255,255,0.03)",
                        border: `1px solid ${selected ? c.color + "55" : "rgba(255,255,255,0.07)"}`,
                        color: selected ? c.color : "var(--text-muted)",
                        textAlign: "left",
                      }}
                    >
                      <span>{c.icon}</span>
                      <span className="leading-tight">{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="label">Notes (optional)</label>
              <input
                className="input"
                value={form.notes || ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>

            {error && (
              <p
                className="text-xs px-3 py-2 rounded-lg"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#fca5a5",
                }}
              >
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <button
                type="button"
                onClick={() => void save()}
                className="btn btn-primary flex-1"
                disabled={Boolean(dupWarning) && !forceDup}
              >
                {remainingAfter > 0 ? "Save & next" : "Save Expense"}
              </button>
              {queuePos.total > 1 && (
                <button type="button" className="btn btn-ghost" onClick={skipCurrent}>
                  Skip
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={resetAll}>
                Cancel all
              </button>
            </div>

            {/* Allow adding more files while reviewing */}
            <div className="pt-1">
              <button
                type="button"
                className="text-xs underline"
                style={{ color: "var(--text-dim)" }}
                onClick={() => fileRef.current?.click()}
              >
                + Add more files to queue
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span>Categorised as:</span>
              <span
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                style={{
                  background: cat.bg,
                  border: `1px solid ${cat.color}33`,
                  color: cat.color,
                }}
              >
                {cat.icon} {cat.label}
              </span>
            </div>
          </motion.div>
        )}

        {stage === "saving" && (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-3 py-8 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            Saving expense…
          </motion.div>
        )}

        {stage === "done" && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3 py-8"
          >
            <p className="text-sm font-medium" style={{ color: "#34d399" }}>
              {queuePos.total > 1 ? "All expenses saved!" : "Expense saved!"}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
