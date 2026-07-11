"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { importInvoice } from "@/actions/invoices";

type Line = { description: string; hsn: string; quantity: number; rate: number; amount: number };

type Extracted = {
  invoiceNumber?: string;
  invoiceDate?: string;
  dueDate?: string;
  buyerName?: string;
  buyerAddress?: string;
  buyerGstin?: string;
  buyerState?: string;
  buyerStateCode?: string;
  serviceDesc?: string;
  lines?: Line[];
  taxableTotal?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  grandTotal?: number;
  paymentStatus?: string;
  remarks?: string;
  confidence?: number;
};

type ItemStatus = "queued" | "uploading" | "extracting" | "ready" | "error" | "saving" | "saved";

type InvoiceItem = {
  id: string;
  file: File;
  preview: string | null;
  status: ItemStatus;
  error?: string;
  filePath?: string;
  extracted?: Extracted;
  form: Extracted;
  expanded: boolean;
};

const PAYMENT_STATUSES = ["UNPAID", "PAID", "PARTIAL", "OVERDUE"];

function makeForm(d: Extracted): Extracted {
  return {
    invoiceNumber: d.invoiceNumber ?? "",
    invoiceDate:   d.invoiceDate ?? new Date().toISOString().split("T")[0],
    dueDate:       d.dueDate ?? "",
    buyerName:     d.buyerName ?? "",
    buyerAddress:  d.buyerAddress ?? "",
    buyerGstin:    d.buyerGstin ?? "",
    buyerState:    d.buyerState ?? "",
    buyerStateCode: d.buyerStateCode ?? "",
    serviceDesc:   d.serviceDesc ?? "",
    taxableTotal:  d.taxableTotal ?? 0,
    cgstAmount:    d.cgstAmount ?? 0,
    sgstAmount:    d.sgstAmount ?? 0,
    igstAmount:    d.igstAmount ?? 0,
    grandTotal:    d.grandTotal ?? 0,
    paymentStatus: d.paymentStatus ?? "UNPAID",
    remarks:       d.remarks ?? "",
    lines:         d.lines ?? [],
  };
}

const STATUS_ICON: Record<ItemStatus, React.ReactNode> = {
  queued:     <span style={{ color: "var(--text-dim)" }}>·</span>,
  uploading:  <Spinner />,
  extracting: <Spinner color="#818cf8" />,
  ready:      <span style={{ color: "#34d399" }}>✓</span>,
  error:      <span style={{ color: "#f87171" }}>✕</span>,
  saving:     <Spinner color="#fbbf24" />,
  saved:      <span style={{ color: "#34d399" }}>✅</span>,
};
const STATUS_LABEL: Record<ItemStatus, string> = {
  queued:     "Queued",
  uploading:  "Uploading…",
  extracting: "Claude reading…",
  ready:      "Ready",
  error:      "Error",
  saving:     "Saving…",
  saved:      "Saved",
};

export function InvoiceImporter({ onSaved }: { onSaved: (nums: string[]) => void }) {
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [savingAll, setSavingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);

  const updateItem = (id: string, patch: Partial<InvoiceItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const updateForm = (id: string, k: string, v: string | number) =>
    setItems((prev) =>
      prev.map((it) => it.id === id ? { ...it, form: { ...it.form, [k]: v } } : it),
    );

  async function processQueue(newItems: InvoiceItem[]) {
    if (processingRef.current) return;
    processingRef.current = true;

    for (const item of newItems) {
      // Upload
      updateItem(item.id, { status: "uploading" });
      const upFd = new FormData();
      upFd.append("file", item.file);
      let filePath = "";
      try {
        const upRes = await fetch("/api/expenses/upload", { method: "POST", body: upFd });
        const upData = await upRes.json() as { filePath?: string; error?: string };
        if (!upRes.ok || !upData.filePath) throw new Error(upData.error || "Upload failed");
        filePath = upData.filePath;
        updateItem(item.id, { filePath });
      } catch (e) {
        updateItem(item.id, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
        continue;
      }

      // Extract with Claude
      updateItem(item.id, { status: "extracting" });
      try {
        const exFd = new FormData();
        exFd.append("file", item.file);
        const exRes = await fetch("/api/invoices/extract", { method: "POST", body: exFd });
        const exData = await exRes.json() as { ok?: boolean; data?: Extracted; error?: string };

        if (!exRes.ok || !exData.ok || !exData.data) {
          const blank: Extracted = { paymentStatus: "UNPAID", taxableTotal: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, grandTotal: 0 };
          updateItem(item.id, {
            status: "ready",
            extracted: blank,
            form: makeForm(blank),
            error: exData.error || "AI extraction failed — fill in manually.",
          });
        } else {
          updateItem(item.id, {
            status: "ready",
            extracted: exData.data,
            form: makeForm(exData.data),
            expanded: false,
          });
        }
      } catch (e) {
        updateItem(item.id, { status: "error", error: e instanceof Error ? e.message : "Extraction failed" });
      }
    }

    processingRef.current = false;
  }

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setGlobalError("");
    const arr = Array.from(files).filter((f) =>
      f.type.startsWith("image/") || f.type === "application/pdf",
    );
    if (!arr.length) {
      setGlobalError("Only image files (JPG/PNG/WebP) and PDFs are supported.");
      return;
    }

    const newItems: InvoiceItem[] = arr.map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file: f,
      preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
      status: "queued",
      form: {},
      expanded: false,
    }));

    setItems((prev) => [...prev, ...newItems]);
    void processQueue(newItems);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  async function saveItem(id: string) {
    const item = items.find((i) => i.id === id);
    if (!item || !item.form.buyerName?.trim() || !item.form.grandTotal) return;
    updateItem(id, { status: "saving" });
    try {
      const f = item.form;
      const res = await importInvoice({
        invoiceNumber: f.invoiceNumber || undefined,
        invoiceDate:   f.invoiceDate!,
        dueDate:       f.dueDate || undefined,
        buyerName:     f.buyerName!,
        buyerAddress:  f.buyerAddress,
        buyerGstin:    f.buyerGstin,
        buyerState:    f.buyerState,
        buyerStateCode: f.buyerStateCode,
        serviceDesc:   f.serviceDesc,
        lines:         (f.lines ?? []).length > 0
          ? f.lines!
          : [{ description: f.serviceDesc || "Service", hsn: "998313", quantity: 1, rate: f.taxableTotal ?? 0, amount: f.taxableTotal ?? 0 }],
        taxableTotal:  f.taxableTotal ?? 0,
        cgstAmount:    f.cgstAmount ?? 0,
        sgstAmount:    f.sgstAmount ?? 0,
        igstAmount:    f.igstAmount ?? 0,
        grandTotal:    f.grandTotal ?? 0,
        paymentStatus: f.paymentStatus,
        remarks:       f.remarks,
        sourceFilePath: item.filePath || undefined,
        rawExtract:    item.extracted ? JSON.stringify(item.extracted) : undefined,
      });
      updateItem(id, { status: "saved", expanded: false, form: { ...item.form, invoiceNumber: res.number } });
      return res.number;
    } catch (e) {
      updateItem(id, { status: "ready", error: e instanceof Error ? e.message : "Save failed" });
    }
  }

  async function saveAll() {
    setSavingAll(true);
    setGlobalError("");
    const readyIds = items.filter((i) => i.status === "ready").map((i) => i.id);
    const savedNums: string[] = [];
    for (const id of readyIds) {
      const num = await saveItem(id);
      if (num) savedNums.push(num);
    }
    setSavingAll(false);
    if (savedNums.length > 0) {
      setTimeout(() => {
        setItems([]);
        onSaved(savedNums);
      }, 800);
    }
  }

  const readyCount  = items.filter((i) => i.status === "ready").length;
  const savedCount  = items.filter((i) => i.status === "saved").length;
  const workingCount = items.filter((i) => i.status === "uploading" || i.status === "extracting").length;

  const showDropZone = items.length === 0;

  return (
    <div className="space-y-4">
      {/* Drop zone — always shown when empty, or as "add more" strip */}
      {showDropZone ? (
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 rounded-xl cursor-pointer transition-all py-10"
          style={{
            border: `2px dashed ${dragOver ? "#818cf8" : "rgba(255,255,255,0.1)"}`,
            background: dragOver ? "rgba(99,102,241,0.06)" : "transparent",
          }}
        >
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" multiple
            onChange={(e) => { if (e.target.files?.length) void handleFiles(e.target.files); e.target.value = ""; }} />
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Drop invoices here or click to browse</p>
            <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
              Select multiple files — Zoho, Tally, QuickBooks, any PDF or image
            </p>
          </div>
        </div>
      ) : (
        /* Add-more strip */
        <div
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all"
          style={{
            border: `1.5px dashed ${dragOver ? "#818cf8" : "rgba(255,255,255,0.08)"}`,
            background: dragOver ? "rgba(99,102,241,0.06)" : "transparent",
          }}
        >
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" multiple
            onChange={(e) => { if (e.target.files?.length) void handleFiles(e.target.files); e.target.value = ""; }} />
          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 4v16m8-8H4"/>
            </svg>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Add more invoices <span style={{ color: "rgba(255,255,255,0.25)" }}>— drop or click</span>
          </p>
          <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: "var(--text-dim)" }}>
            {workingCount > 0 && <span style={{ color: "#818cf8" }}>{workingCount} processing…</span>}
            {readyCount > 0 && <span style={{ color: "#34d399" }}>{readyCount} ready</span>}
            {savedCount > 0 && <span>✅ {savedCount} saved</span>}
          </div>
        </div>
      )}

      {globalError && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
          {globalError}
        </div>
      )}

      {/* Queue list */}
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border)", background: "var(--bg-elevated)" }}
          >
            {/* Row header */}
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
              style={{ borderBottom: item.expanded ? "1px solid var(--border)" : "none" }}
              onClick={() => {
                if (item.status === "ready" || item.status === "error")
                  updateItem(item.id, { expanded: !item.expanded });
              }}
            >
              {/* Thumbnail */}
              {item.preview ? (
                <img src={item.preview} alt="" className="rounded shrink-0 object-cover"
                  style={{ width: 32, height: 40, border: "1px solid var(--border)" }} />
              ) : (
                <div className="rounded shrink-0 flex items-center justify-center"
                  style={{ width: 32, height: 40, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"/>
                    <path d="M14 2v6h6"/>
                  </svg>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.file.name}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs" style={{
                    color: item.status === "ready" || item.status === "saved" ? "#34d399"
                      : item.status === "error" ? "#f87171"
                      : item.status === "uploading" || item.status === "extracting" ? "#818cf8"
                      : "var(--text-dim)",
                  }}>
                    {STATUS_LABEL[item.status]}
                  </span>
                  {(item.status === "ready" || item.status === "saved") && item.form.buyerName && (
                    <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                      · {item.form.buyerName}
                      {item.form.grandTotal ? ` · ₹${Number(item.form.grandTotal).toLocaleString("en-IN")}` : ""}
                    </span>
                  )}
                  {item.error && item.status !== "error" && (
                    <span className="text-xs" style={{ color: "#fbbf24" }}>⚠ {item.error}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-base w-5 text-center">{STATUS_ICON[item.status]}</span>

                {item.status === "ready" && (
                  <button
                    type="button"
                    className="text-xs px-2.5 py-1 rounded-lg font-medium transition-all"
                    style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8" }}
                    onClick={(e) => { e.stopPropagation(); void saveItem(item.id); }}
                  >
                    Save
                  </button>
                )}
                {(item.status === "ready" || item.status === "error") && (
                  <motion.span
                    animate={{ rotate: item.expanded ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                    style={{ color: "var(--text-dim)" }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M19 9l-7 7-7-7"/>
                    </svg>
                  </motion.span>
                )}

                <button
                  type="button"
                  className="w-6 h-6 rounded flex items-center justify-center transition-all"
                  style={{ color: "var(--text-dim)" }}
                  title="Remove"
                  onClick={(e) => { e.stopPropagation(); setItems((prev) => prev.filter((i) => i.id !== item.id)); }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Expandable confirm form */}
            <AnimatePresence>
              {item.expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{ overflow: "hidden" }}
                >
                  <div className="p-4 space-y-4">
                    {item.error && (
                      <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                        ⚠ {item.error}
                      </div>
                    )}

                    {/* Confidence */}
                    {item.extracted?.confidence !== undefined && item.extracted.confidence < 0.75 && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
                        style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
                        ⚠ Low confidence ({Math.round(item.extracted.confidence * 100)}%) — please verify.
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <InlineField label="Invoice #" value={item.form.invoiceNumber ?? ""} onChange={(v) => updateForm(item.id, "invoiceNumber", v)} placeholder="Auto-generated if blank" />
                      <InlineField label="Invoice Date *" value={item.form.invoiceDate ?? ""} onChange={(v) => updateForm(item.id, "invoiceDate", v)} type="date" />
                      <InlineField label="Due Date" value={item.form.dueDate ?? ""} onChange={(v) => updateForm(item.id, "dueDate", v)} type="date" />
                      <div>
                        <label className="block text-[0.6rem] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>Payment Status</label>
                        <select className="input w-full text-xs" value={item.form.paymentStatus ?? "UNPAID"}
                          onChange={(e) => updateForm(item.id, "paymentStatus", e.target.value)}>
                          {PAYMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    </div>

                    <div>
                      <p className="text-[0.6rem] tracking-[0.1em] uppercase mb-2 font-semibold" style={{ color: "#818cf8" }}>Buyer</p>
                      <div className="grid grid-cols-2 gap-3">
                        <InlineField label="Name *" value={item.form.buyerName ?? ""} onChange={(v) => updateForm(item.id, "buyerName", v)} className="col-span-2" />
                        <InlineField label="Address" value={item.form.buyerAddress ?? ""} onChange={(v) => updateForm(item.id, "buyerAddress", v)} className="col-span-2" />
                        <InlineField label="GSTIN" value={item.form.buyerGstin ?? ""} onChange={(v) => updateForm(item.id, "buyerGstin", v)} />
                        <InlineField label="State" value={item.form.buyerState ?? ""} onChange={(v) => updateForm(item.id, "buyerState", v)} />
                      </div>
                    </div>

                    <div>
                      <p className="text-[0.6rem] tracking-[0.1em] uppercase mb-2 font-semibold" style={{ color: "#fbbf24" }}>Amounts (₹)</p>
                      <div className="grid grid-cols-3 gap-3">
                        <InlineField label="Taxable" value={String(item.form.taxableTotal ?? 0)} onChange={(v) => updateForm(item.id, "taxableTotal", Number(v))} type="number" />
                        <InlineField label="CGST" value={String(item.form.cgstAmount ?? 0)} onChange={(v) => updateForm(item.id, "cgstAmount", Number(v))} type="number" />
                        <InlineField label="SGST" value={String(item.form.sgstAmount ?? 0)} onChange={(v) => updateForm(item.id, "sgstAmount", Number(v))} type="number" />
                        <InlineField label="IGST" value={String(item.form.igstAmount ?? 0)} onChange={(v) => updateForm(item.id, "igstAmount", Number(v))} type="number" />
                        <InlineField label="Grand Total *" value={String(item.form.grandTotal ?? 0)} onChange={(v) => updateForm(item.id, "grandTotal", Number(v))} type="number" className="col-span-2" />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      <InlineField label="Service Description" value={item.form.serviceDesc ?? ""} onChange={(v) => updateForm(item.id, "serviceDesc", v)} />
                      <InlineField label="Remarks / Reference" value={item.form.remarks ?? ""} onChange={(v) => updateForm(item.id, "remarks", v)} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Save All footer */}
      {readyCount > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between px-4 py-3 rounded-xl"
          style={{ background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            <span className="font-semibold" style={{ color: "#818cf8" }}>{readyCount}</span> invoices ready to save
          </p>
          <button
            type="button"
            className="btn btn-primary text-sm"
            disabled={savingAll}
            onClick={() => void saveAll()}
          >
            {savingAll ? "Saving…" : `Save All ${readyCount} →`}
          </button>
        </motion.div>
      )}
    </div>
  );
}

function Spinner({ color = "#818cf8" }: { color?: string }) {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      style={{
        display: "inline-block",
        width: 12, height: 12,
        border: `2px solid ${color}33`,
        borderTopColor: color,
        borderRadius: "50%",
      }}
    />
  );
}

function InlineField({
  label, value, onChange, type = "text", placeholder, className,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[0.6rem] tracking-[0.1em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>{label}</label>
      <input
        type={type}
        className="input w-full text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
      />
    </div>
  );
}
