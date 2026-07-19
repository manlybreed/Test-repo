"use client";

import { useState, useTransition } from "react";
import { exportGstr1Action } from "@/actions/invoices";

export function InvoiceGstr1Export() {
  const [pending, start] = useTransition();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [anomalies, setAnomalies] = useState<string[]>([]);

  function run() {
    start(async () => {
      const res = await exportGstr1Action({
        from: from || undefined,
        to: to || undefined,
      });
      setAnomalies(res.anomalies);
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gstr1-export-${from || "all"}-${to || "all"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div
      className="rounded-xl p-4 mb-6 space-y-3"
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">GSTR-1 from</label>
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="label">to</label>
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          disabled={pending}
          onClick={run}
        >
          {pending ? "Exporting…" : "Export GSTR-1 CSV + AI anomalies"}
        </button>
      </div>
      {anomalies.length > 0 && (
        <ul className="text-xs space-y-1" style={{ color: "#fbbf24" }}>
          {anomalies.map((a) => (
            <li key={a}>⚠ {a}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
