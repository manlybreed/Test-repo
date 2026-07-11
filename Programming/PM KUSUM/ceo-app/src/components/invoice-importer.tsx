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
  sellerName?: string;
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

type Stage = "idle" | "uploading" | "extracting" | "confirm" | "saving" | "done";

const PAYMENT_STATUSES = ["UNPAID", "PAID", "PARTIAL", "OVERDUE"];

export function InvoiceImporter({ onSaved }: { onSaved: (num: string) => void }) {
  const [stage, setStage]       = useState<Stage>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview]   = useState<string | null>(null);
  const [error, setError]       = useState("");
  const [extracted, setExtracted] = useState<Extracted>({});
  const [form, setForm]         = useState<Extracted>({});
  const [filePath, setFilePath] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    setError("");
    setFileName(file.name);

    if (file.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(file));
    } else {
      setPreview(null);
    }

    // Step 1: upload
    setStage("uploading");
    const upFd = new FormData();
    upFd.append("file", file);
    const upRes = await fetch("/api/expenses/upload", { method: "POST", body: upFd });
    const upData = await upRes.json() as { filePath?: string; error?: string };
    if (!upRes.ok || !upData.filePath) {
      setError(upData.error || "Upload failed");
      setStage("idle");
      return;
    }
    setFilePath(upData.filePath);

    // Step 2: extract with Claude
    setStage("extracting");
    const exFd = new FormData();
    exFd.append("file", file);
    const exRes = await fetch("/api/invoices/extract", { method: "POST", body: exFd });
    const exData = await exRes.json() as { ok?: boolean; data?: Extracted; error?: string };

    if (!exRes.ok || !exData.ok || !exData.data) {
      setError(exData.error || "AI extraction failed — please fill in the details manually.");
      const blank: Extracted = { paymentStatus: "UNPAID", taxableTotal: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, grandTotal: 0 };
      setExtracted(blank);
      setForm(blank);
    } else {
      const d = exData.data;
      setExtracted(d);
      setForm({
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
      });
    }
    setStage("confirm");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  async function handleSave() {
    if (!form.buyerName?.trim() || !form.invoiceDate || !form.grandTotal) {
      setError("Buyer name, date and total amount are required.");
      return;
    }
    setStage("saving");
    setError("");
    try {
      const res = await importInvoice({
        invoiceNumber: form.invoiceNumber || undefined,
        invoiceDate:   form.invoiceDate!,
        dueDate:       form.dueDate || undefined,
        buyerName:     form.buyerName!,
        buyerAddress:  form.buyerAddress,
        buyerGstin:    form.buyerGstin,
        buyerState:    form.buyerState,
        buyerStateCode: form.buyerStateCode,
        serviceDesc:   form.serviceDesc,
        lines:         (form.lines ?? []).length > 0
          ? form.lines!
          : [{ description: form.serviceDesc || "Service", hsn: "998313", quantity: 1, rate: form.taxableTotal ?? 0, amount: form.taxableTotal ?? 0 }],
        taxableTotal:  form.taxableTotal ?? 0,
        cgstAmount:    form.cgstAmount ?? 0,
        sgstAmount:    form.sgstAmount ?? 0,
        igstAmount:    form.igstAmount ?? 0,
        grandTotal:    form.grandTotal ?? 0,
        paymentStatus: form.paymentStatus,
        remarks:       form.remarks,
        sourceFilePath: filePath || undefined,
        rawExtract:    JSON.stringify(extracted),
      });
      setStage("done");
      setTimeout(() => {
        setStage("idle");
        setForm({});
        setExtracted({});
        setPreview(null);
        setFileName("");
        onSaved(res.number);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setStage("confirm");
    }
  }

  if (stage === "done") {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-semibold" style={{ color: "#34d399" }}>Invoice imported!</p>
        </div>
      </div>
    );
  }

  if (stage === "idle") {
    return (
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
        <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
        <div className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">Drop invoice here or click to browse</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
            Zoho, Tally, QuickBooks, any PDF or image · Claude extracts all details automatically
          </p>
        </div>
      </div>
    );
  }

  if (stage === "uploading" || stage === "extracting") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
          style={{ width: 36, height: 36, border: "3px solid rgba(99,102,241,0.15)", borderTopColor: "#818cf8", borderRadius: "50%" }}
        />
        <div className="text-center">
          <p className="text-sm font-medium">{stage === "uploading" ? "Uploading…" : "Claude is reading the invoice…"}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>{fileName}</p>
        </div>
      </div>
    );
  }

  const conf = extracted.confidence ?? 1;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="space-y-5"
      >
        {/* Confidence banner */}
        {conf < 0.75 && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
            <span>⚠</span>
            <span>Low confidence ({Math.round(conf * 100)}%) — please verify the extracted data below.</span>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171" }}>
            {error}
          </div>
        )}

        {/* Preview + fields grid */}
        <div className="flex gap-4">
          {preview && (
            <div className="shrink-0">
              <img src={preview} alt="invoice" className="rounded-lg object-contain"
                style={{ width: 120, height: 160, border: "1px solid var(--border)", background: "rgba(0,0,0,0.2)" }} />
            </div>
          )}
          <div className="flex-1 grid grid-cols-2 gap-3">
            <Field label="Invoice Number" value={form.invoiceNumber ?? ""} onChange={(v) => set("invoiceNumber", v)} placeholder="Auto-generated if blank" />
            <Field label="Invoice Date *" value={form.invoiceDate ?? ""} onChange={(v) => set("invoiceDate", v)} type="date" />
            <Field label="Due Date" value={form.dueDate ?? ""} onChange={(v) => set("dueDate", v)} type="date" />
            <div>
              <label className="block text-[0.65rem] tracking-[0.1em] uppercase mb-1 font-medium" style={{ color: "var(--text-dim)" }}>Payment Status</label>
              <select
                className="input w-full text-sm"
                value={form.paymentStatus ?? "UNPAID"}
                onChange={(e) => set("paymentStatus", e.target.value)}
              >
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Buyer */}
        <div>
          <p className="text-[0.65rem] tracking-[0.1em] uppercase mb-2 font-semibold" style={{ color: "#818cf8" }}>Buyer / Client</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Buyer Name *" value={form.buyerName ?? ""} onChange={(v) => set("buyerName", v)} className="col-span-2" />
            <Field label="Address" value={form.buyerAddress ?? ""} onChange={(v) => set("buyerAddress", v)} className="col-span-2" />
            <Field label="GSTIN" value={form.buyerGstin ?? ""} onChange={(v) => set("buyerGstin", v)} />
            <Field label="State" value={form.buyerState ?? ""} onChange={(v) => set("buyerState", v)} />
          </div>
        </div>

        {/* Amounts */}
        <div>
          <p className="text-[0.65rem] tracking-[0.1em] uppercase mb-2 font-semibold" style={{ color: "#fbbf24" }}>Amounts (₹)</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Taxable Total" value={String(form.taxableTotal ?? 0)} onChange={(v) => set("taxableTotal", Number(v))} type="number" />
            <Field label="CGST" value={String(form.cgstAmount ?? 0)} onChange={(v) => set("cgstAmount", Number(v))} type="number" />
            <Field label="SGST" value={String(form.sgstAmount ?? 0)} onChange={(v) => set("sgstAmount", Number(v))} type="number" />
            <Field label="IGST" value={String(form.igstAmount ?? 0)} onChange={(v) => set("igstAmount", Number(v))} type="number" />
            <Field label="Grand Total *" value={String(form.grandTotal ?? 0)} onChange={(v) => set("grandTotal", Number(v))} type="number" className="col-span-2" />
          </div>
        </div>

        {/* Service & remarks */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Service Description" value={form.serviceDesc ?? ""} onChange={(v) => set("serviceDesc", v)} className="col-span-2" />
          <Field label="Remarks / Reference" value={form.remarks ?? ""} onChange={(v) => set("remarks", v)} className="col-span-2" />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button type="button" className="btn btn-ghost text-xs" onClick={() => { setStage("idle"); setForm({}); setError(""); }}>
            ← Try another file
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={stage === "saving" || !form.buyerName?.trim() || !form.grandTotal}
            onClick={() => void handleSave()}
          >
            {stage === "saving" ? "Saving…" : "Save Invoice →"}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, className,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[0.65rem] tracking-[0.1em] uppercase mb-1 font-medium" style={{ color: "var(--text-dim)" }}>{label}</label>
      <input
        type={type}
        className="input w-full text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        step={type === "number" ? "0.01" : undefined}
      />
    </div>
  );
}
