"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { classifyAllInvoiceGstEntities } from "@/actions/invoices";

export function GstClassifyButton({ invoiceCount }: { invoiceCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{
    updated: number;
    results: { number: string; previous: string | null; gstEntity: string; method: string }[];
  } | null>(null);
  const [error, setError] = useState("");

  function run() {
    setError("");
    setResult(null);
    start(async () => {
      try {
        const res = await classifyAllInvoiceGstEntities();
        setResult(res);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Classification failed");
      }
    });
  }

  const changed = result?.results.filter((r) => r.previous !== r.gstEntity) ?? [];

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        className="btn btn-ghost text-xs py-1.5 px-3"
        onClick={run}
        disabled={pending || invoiceCount === 0}
        title="Use AI to detect DEL vs RAJ GST from invoice PDFs and stored extracts"
      >
        {pending ? "Classifying GST…" : "✦ Classify GST with AI"}
      </button>
      {result && !pending && (
        <p className="text-[0.65rem] text-right max-w-xs" style={{ color: "var(--text-dim)" }}>
          {changed.length > 0
            ? `Updated ${changed.length} invoice${changed.length === 1 ? "" : "s"}: ${changed.map((r) => `${r.number}→${r.gstEntity}`).join(", ")}`
            : `Checked ${result.updated} — all GST tags already correct`}
        </p>
      )}
      {error && (
        <p className="text-[0.65rem] text-right" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
