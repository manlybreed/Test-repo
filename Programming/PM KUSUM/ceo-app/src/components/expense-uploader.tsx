"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createExpense } from "@/actions/expenses";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { GstEntitySelect } from "@/components/gst-entity-select";
import type { GstEntity } from "@/lib/gst-entities";

type Extracted = {
  vendor?: string;
  amount?: number;
  date?: string;
  invoiceNo?: string;
  description?: string;
  gstAmount?: number;
  paymentMode?: string;
  category?: string;
  confidence?: number;
  needsReview?: boolean;
};

type Stage = "idle" | "uploading" | "extracting" | "confirm" | "saving" | "done";

export function ExpenseUploader({ onSaved }: { onSaved: () => void }) {
  const [stage, setStage]         = useState<Stage>("idle");
  const [dragOver, setDragOver]   = useState(false);
  const [preview, setPreview]     = useState<string | null>(null);
  const [fileName, setFileName]   = useState("");
  const [extracted, setExtracted] = useState<Extracted>({});
  const [filePath, setFilePath]   = useState("");
  const [form, setForm]           = useState<Extracted & { notes?: string; gstEntity?: GstEntity }>({});
  const [error, setError]         = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const fileObj = useRef<File | null>(null);

  const set = (k: string, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleFile = useCallback(async (file: File) => {
    if (!file) return;
    setError("");
    fileObj.current = file;
    setFileName(file.name);

    // Preview for images
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }

    // 1. Upload file
    setStage("uploading");
    const upFd = new FormData();
    upFd.append("file", file);
    const upRes = await fetch("/api/expenses/upload", { method: "POST", body: upFd });
    const upData = await upRes.json() as { filePath?: string; error?: string };
    if (!upData.filePath) { setError("Upload failed."); setStage("idle"); return; }
    setFilePath(upData.filePath);

    // 2. Extract with Claude vision
    setStage("extracting");
    const exFd = new FormData();
    exFd.append("file", file);
    const exRes = await fetch("/api/expenses/extract", { method: "POST", body: exFd });
    const exData = await exRes.json() as { ok?: boolean; data?: Extracted; error?: string };
    if (!exData.ok || !exData.data) { setError("Extraction failed — please fill manually."); }

    const d = exData.data || {};
    setExtracted(d);
    setForm({
      vendor:      d.vendor || "",
      amount:      d.amount,
      date:        d.date || new Date().toISOString().split("T")[0],
      invoiceNo:   d.invoiceNo || "",
      description: d.description || "",
      gstAmount:   d.gstAmount,
      paymentMode: d.paymentMode || "",
      category:    d.category || "misc",
      notes:       "",
      gstEntity:   "DEL",
    });
    setStage("confirm");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  async function save() {
    if (!form.vendor || !form.amount || !form.date || !form.category) {
      setError("Vendor, amount, date and category are required.");
      return;
    }
    setStage("saving");
    setError("");
    try {
      await createExpense({
        vendor:      form.vendor!,
        amount:      Number(form.amount),
        date:        form.date!,
        category:    form.category!,
        subCategory: undefined,
        description: form.description,
        paymentMode: form.paymentMode,
        gstAmount:   form.gstAmount ? Number(form.gstAmount) : undefined,
        gstEntity:   form.gstEntity || "DEL",
        invoiceNo:   form.invoiceNo,
        filePath,
        rawExtract:  JSON.stringify(extracted),
        notes:       form.notes,
        needsReview: extracted.needsReview ?? false,
      });
      setStage("done");
      setTimeout(() => {
        setStage("idle");
        setPreview(null);
        setFileName("");
        setFilePath("");
        setExtracted({});
        setForm({});
        onSaved();
      }, 1800);
    } catch {
      setError("Save failed — try again.");
      setStage("confirm");
    }
  }

  const cat = EXPENSE_CATEGORIES.find((c) => c.id === form.category) ?? EXPENSE_CATEGORIES[0];
  const confidence = extracted.confidence ?? 0;
  const needsReview = extracted.needsReview || confidence < 0.7;

  return (
    <div>
      {/* Drop zone */}
      <AnimatePresence mode="wait">
        {stage === "idle" && (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileRef.current?.click()}
              className="relative flex flex-col items-center justify-center gap-3 rounded-xl cursor-pointer transition-all"
              style={{
                border: `2px dashed ${dragOver ? "var(--accent)" : "rgba(255,255,255,0.1)"}`,
                background: dragOver ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.02)",
                padding: "3rem 2rem",
              }}
            >
              <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">Drop your bill or invoice here</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                  JPG, PNG, PDF — Claude will extract all details automatically
                </p>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "var(--accent)", color: "#fff" }}>
                Browse files
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>

            {/* Also allow manual entry */}
            <button
              type="button"
              className="mt-3 w-full text-xs py-2.5 rounded-lg transition-all"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
              onClick={() => {
                setExtracted({});
                setForm({ date: new Date().toISOString().split("T")[0], category: "misc", gstEntity: "DEL" });
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
            className="flex flex-col items-center gap-4 py-12"
          >
            <div className="relative w-14 h-14">
              <div className="absolute inset-0 rounded-full"
                style={{ border: "2px solid rgba(99,102,241,0.15)" }} />
              <div className="absolute inset-0 rounded-full"
                style={{ border: "2px solid transparent", borderTopColor: "var(--accent)", animation: "spin 0.9s linear infinite" }} />
              <div className="absolute inset-2 rounded-full flex items-center justify-center"
                style={{ background: "rgba(99,102,241,0.1)", color: "#818cf8" }}>
                {stage === "uploading" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                  </svg>
                )}
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {stage === "uploading" ? "Uploading bill…" : "Claude is reading your bill…"}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                {fileName}
              </p>
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
            {/* Preview + header */}
            <div className="flex items-start gap-4">
              {preview && (
                <img
                  src={preview}
                  alt="Bill preview"
                  className="w-20 h-20 object-cover rounded-lg shrink-0"
                  style={{ border: "1px solid rgba(255,255,255,0.08)" }}
                />
              )}
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-semibold">
                    {fileName || "Manual entry"}
                  </p>
                  {needsReview && (
                    <span className="text-xs px-2 py-0.5 rounded-md"
                      style={{ background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", color: "#fb923c" }}>
                      ⚠ Review needed
                    </span>
                  )}
                  {!needsReview && confidence > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-md"
                      style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}>
                      ✓ {Math.round(confidence * 100)}% confident
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                  {needsReview
                    ? "Please verify the extracted details below and correct if needed."
                    : "Details extracted. Verify and save."}
                </p>
              </div>
            </div>

            {/* Form grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Vendor / Merchant *</label>
                <input className="input" value={form.vendor || ""} onChange={(e) => set("vendor", e.target.value)} placeholder="e.g. Airtel, Amazon" />
              </div>
              <div>
                <label className="label">Amount (₹) *</label>
                <input className="input" type="number" step="0.01" value={form.amount ?? ""} onChange={(e) => set("amount", parseFloat(e.target.value))} placeholder="0.00" />
              </div>
              <div>
                <label className="label">Date *</label>
                <input className="input" type="date" value={form.date || ""} onChange={(e) => set("date", e.target.value)} />
              </div>
              <div>
                <label className="label">Invoice / Receipt No.</label>
                <input className="input" value={form.invoiceNo || ""} onChange={(e) => set("invoiceNo", e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="label">GST Amount (₹)</label>
                <input className="input" type="number" step="0.01" value={form.gstAmount ?? ""} onChange={(e) => set("gstAmount", parseFloat(e.target.value))} placeholder="Auto-detected" />
              </div>
              <div>
                <label className="label">Payment Mode</label>
                <select className="input" value={form.paymentMode || ""} onChange={(e) => set("paymentMode", e.target.value)}>
                  <option value="">— select —</option>
                  {["UPI", "Cash", "Card", "Net Banking", "NEFT", "IMPS", "Cheque"].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <GstEntitySelect
                  label="Vendor invoice booked under BluRidge GST"
                  value={form.gstEntity || "DEL"}
                  onChange={(v) => set("gstEntity", v)}
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="label">Description</label>
              <input className="input" value={form.description || ""} onChange={(e) => set("description", e.target.value)} placeholder="What was this for?" />
            </div>

            {/* Category grid */}
            <div>
              <label className="label flex items-center gap-2">
                Category *
                {needsReview && (
                  <span style={{ color: "#fb923c", fontSize: "0.65rem" }}>← AI needs your help here</span>
                )}
              </label>
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
                        cursor: "pointer",
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

            {/* Notes */}
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder="Any additional context" />
            </div>

            {error && (
              <p className="text-xs px-3 py-2 rounded-lg"
                style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
                {error}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={save}
                className="btn btn-primary flex-1"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8"/>
                </svg>
                Save Expense
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setStage("idle"); setError(""); setPreview(null); setFileName(""); }}
              >
                Cancel
              </button>
            </div>

            {/* Category preview chip */}
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-dim)" }}>
              <span>Categorised as:</span>
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
                style={{ background: cat.bg, border: `1px solid ${cat.color}33`, color: cat.color }}>
                {cat.icon} {cat.label}
              </span>
            </div>
          </motion.div>
        )}

        {stage === "saving" && (
          <motion.div key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex items-center justify-center gap-3 py-8 text-sm" style={{ color: "var(--text-muted)" }}>
            <span className="loading-spin" /> Saving expense…
          </motion.div>
        )}

        {stage === "done" && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3 py-8">
            <div className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: "#34d399" }}>Expense saved!</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
