"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { InvoiceStatusCell } from "@/components/invoice-status-cell";
import { InvoiceDeleteButton } from "@/components/invoice-row-actions";
import { GstEntityBadge } from "@/components/gst-entity-select";
import { GstClassifyButton } from "@/components/gst-classify-button";
import { formatINR } from "@/lib/utils";

export type InvoiceDbRow = {
  id: string;
  number: string;
  buyerName: string;
  remarks: string | null;
  serviceDesc: string | null;
  invoiceDate: string; // ISO date
  dueDate: string | null;
  gstEntity: string | null;
  paymentStatus: string | null;
  tdsDeducted: boolean;
  tdsPercent: number | null;
  taxableTotal: number;
  grandTotal: number;
  isImported: boolean;
  filePath: string | null;
  sourceFilePath: string | null;
};

type GstFilter = "ALL" | "DEL" | "RAJ";
type TdsFilter = "ALL" | "YES" | "NO";

function startOfDay(iso: string) {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(iso: string) {
  const d = new Date(iso);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function InvoiceDatabase({ invoices }: { invoices: InvoiceDbRow[] }) {
  const [buyer, setBuyer] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [gst, setGst] = useState<GstFilter>("ALL");
  const [tds, setTds] = useState<TdsFilter>("ALL");

  const buyerOptions = useMemo(() => {
    const names = [...new Set(invoices.map((i) => i.buyerName))].sort((a, b) =>
      a.localeCompare(b),
    );
    return names;
  }, [invoices]);

  const filtered = useMemo(() => {
    const q = buyer.trim().toLowerCase();
    const min = amountMin.trim() === "" ? null : Number(amountMin);
    const max = amountMax.trim() === "" ? null : Number(amountMax);
    const from = dateFrom ? startOfDay(dateFrom) : null;
    const to = dateTo ? endOfDay(dateTo) : null;

    return invoices.filter((inv) => {
      if (q && !inv.buyerName.toLowerCase().includes(q)) return false;

      const invDate = new Date(inv.invoiceDate);
      if (from && invDate < from) return false;
      if (to && invDate > to) return false;

      if (min != null && !Number.isNaN(min) && inv.grandTotal < min) return false;
      if (max != null && !Number.isNaN(max) && inv.grandTotal > max) return false;

      if (gst !== "ALL") {
        const entity = inv.gstEntity === "RAJ" ? "RAJ" : "DEL";
        if (entity !== gst) return false;
      }

      if (tds === "YES" && !inv.tdsDeducted) return false;
      if (tds === "NO" && inv.tdsDeducted) return false;

      return true;
    });
  }, [invoices, buyer, dateFrom, dateTo, amountMin, amountMax, gst, tds]);

  const numCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of invoices) m.set(inv.number, (m.get(inv.number) ?? 0) + 1);
    return m;
  }, [invoices]);

  const hasFilters =
    buyer || dateFrom || dateTo || amountMin || amountMax || gst !== "ALL" || tds !== "ALL";

  function clearFilters() {
    setBuyer("");
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
    setGst("ALL");
    setTds("ALL");
  }

  const filteredTotal = filtered.reduce((s, i) => s + i.grandTotal, 0);

  return (
    <section>
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Invoice database</h2>
          <span
            className="text-xs px-2 py-0.5 rounded-md tabular-nums"
            style={{
              background: "rgba(240,180,41,0.1)",
              border: "1px solid rgba(240,180,41,0.2)",
              color: "#fbbf24",
            }}
          >
            {filtered.length}
            {hasFilters ? ` / ${invoices.length}` : ""}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <GstClassifyButton invoiceCount={invoices.length} />
          <p className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Click status to update · TDS toggles deduction
          </p>
        </div>
      </div>

      {/* Filters */}
      <div
        className="rounded-xl p-4 mb-4 space-y-3"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p
            className="text-[0.6rem] uppercase tracking-[0.16em] font-semibold"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            Filters
          </p>
          <div className="flex items-center gap-3">
            {hasFilters && (
              <p className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.45)" }}>
                Showing {formatINR(filteredTotal)} across {filtered.length} invoice
                {filtered.length === 1 ? "" : "s"}
              </p>
            )}
            {hasFilters && (
              <button type="button" className="btn btn-ghost text-xs py-1 px-2" onClick={clearFilters}>
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2">
            <label className="label">Buyer</label>
            <input
              className="input"
              list="invoice-buyer-filter"
              placeholder="Search buyer name…"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
            />
            <datalist id="invoice-buyer-filter">
              {buyerOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="label">Date from</label>
            <input
              className="input"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Date to</label>
            <input
              className="input"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Amount min (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="0"
              value={amountMin}
              onChange={(e) => setAmountMin(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Amount max (₹)</label>
            <input
              className="input"
              type="number"
              min={0}
              placeholder="Any"
              value={amountMax}
              onChange={(e) => setAmountMax(e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-1">
          <div>
            <p className="label mb-1.5">GST</p>
            <div className="flex gap-1.5">
              {(["ALL", "DEL", "RAJ"] as GstFilter[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setGst(v)}
                  className="text-[0.65rem] font-bold px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background:
                      gst === v
                        ? v === "RAJ"
                          ? "rgba(251,191,36,0.15)"
                          : v === "DEL"
                            ? "rgba(99,102,241,0.15)"
                            : "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.02)",
                    color:
                      gst === v
                        ? v === "RAJ"
                          ? "#fbbf24"
                          : v === "DEL"
                            ? "#a5b4fc"
                            : "rgba(255,255,255,0.85)"
                        : "rgba(255,255,255,0.4)",
                    border: `1px solid ${
                      gst === v
                        ? v === "RAJ"
                          ? "rgba(251,191,36,0.35)"
                          : v === "DEL"
                            ? "rgba(99,102,241,0.35)"
                            : "rgba(255,255,255,0.15)"
                        : "rgba(255,255,255,0.08)"
                    }`,
                  }}
                >
                  {v === "ALL" ? "All" : v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label mb-1.5">TDS</p>
            <div className="flex gap-1.5">
              {(
                [
                  { id: "ALL", label: "All" },
                  { id: "YES", label: "Deducted" },
                  { id: "NO", label: "Not deducted" },
                ] as const
              ).map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setTds(v.id)}
                  className="text-[0.65rem] font-bold px-2.5 py-1 rounded-lg transition-all"
                  style={{
                    background:
                      tds === v.id
                        ? "rgba(139,92,246,0.15)"
                        : "rgba(255,255,255,0.02)",
                    color: tds === v.id ? "#a78bfa" : "rgba(255,255,255,0.4)",
                    border: `1px solid ${
                      tds === v.id ? "rgba(139,92,246,0.35)" : "rgba(255,255,255,0.08)"
                    }`,
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
        <table className="data">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Invoice No.</th>
              <th>Buyer</th>
              <th>Date</th>
              <th>GST</th>
              <th>Status / TDS</th>
              <th>Taxable</th>
              <th>Grand Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => {
              const isDupe = (numCount.get(inv.number) ?? 0) > 1;
              return (
                <tr key={inv.id} style={isDupe ? { background: "rgba(251,191,36,0.04)" } : undefined}>
                  <td>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="font-mono font-semibold text-sm"
                        style={{ color: isDupe ? "#fbbf24" : "#818cf8" }}
                      >
                        {inv.number}
                      </span>
                      {isDupe && (
                        <span
                          className="text-[0.55rem] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: "rgba(251,191,36,0.12)",
                            color: "#fbbf24",
                            border: "1px solid rgba(251,191,36,0.3)",
                          }}
                        >
                          DUPLICATE
                        </span>
                      )}
                      {inv.isImported && (
                        <span
                          className="text-[0.55rem] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: "rgba(99,102,241,0.12)",
                            color: "#818cf8",
                            border: "1px solid rgba(99,102,241,0.2)",
                          }}
                        >
                          IMPORTED
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <p className="font-medium text-sm">{inv.buyerName}</p>
                    {(inv.remarks || inv.serviceDesc) && (
                      <p
                        className="text-xs mt-0.5 truncate max-w-[200px]"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {inv.remarks || inv.serviceDesc}
                      </p>
                    )}
                  </td>
                  <td style={{ color: "rgba(255,255,255,0.72)", fontSize: "0.82rem" }}>
                    <div>{new Date(inv.invoiceDate).toLocaleDateString("en-IN")}</div>
                    {inv.dueDate && (
                      <div className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                        Due {new Date(inv.dueDate).toLocaleDateString("en-IN")}
                      </div>
                    )}
                  </td>
                  <td>
                    <GstEntityBadge value={inv.gstEntity} />
                  </td>
                  <td>
                    <InvoiceStatusCell
                      invoiceId={inv.id}
                      initialStatus={inv.paymentStatus}
                      initialTdsDeducted={inv.tdsDeducted}
                      initialTdsPercent={inv.tdsPercent}
                    />
                  </td>
                  <td className="tabular-nums text-sm" style={{ color: "rgba(255,255,255,0.72)" }}>
                    {formatINR(inv.taxableTotal)}
                  </td>
                  <td>
                    <span className="tabular-nums font-semibold" style={{ color: "#fbbf24" }}>
                      {formatINR(inv.grandTotal)}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1 flex-wrap">
                      {inv.filePath && (
                        <>
                          <Link
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: "rgba(99,102,241,0.08)",
                              border: "1px solid rgba(99,102,241,0.2)",
                              color: "#818cf8",
                            }}
                            href={`/api/files/${inv.filePath}`}
                            target="_blank"
                            title="View PDF"
                          >
                            View
                          </Link>
                          <Link
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: "rgba(240,180,41,0.08)",
                              border: "1px solid rgba(240,180,41,0.2)",
                              color: "#fbbf24",
                            }}
                            href={`/api/files/${inv.filePath}`}
                            download={`${inv.number}.pdf`}
                            title="Download PDF"
                          >
                            PDF
                          </Link>
                        </>
                      )}
                      {inv.sourceFilePath && (
                        <>
                          <Link
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: "rgba(52,211,153,0.08)",
                              border: "1px solid rgba(52,211,153,0.2)",
                              color: "#34d399",
                            }}
                            href={`/${inv.sourceFilePath}`}
                            target="_blank"
                            title="View original invoice"
                          >
                            Orig
                          </Link>
                          <Link
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                            style={{
                              background: "rgba(52,211,153,0.08)",
                              border: "1px solid rgba(52,211,153,0.2)",
                              color: "#34d399",
                            }}
                            href={`/${inv.sourceFilePath}`}
                            download
                            title="Download original"
                          >
                            DL
                          </Link>
                        </>
                      )}
                      <InvoiceDeleteButton
                        invoiceId={inv.id}
                        invoiceNumber={inv.number}
                        buyerName={inv.buyerName}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <p style={{ color: "rgba(255,255,255,0.4)" }}>
                    {invoices.length === 0
                      ? "No invoices yet — create your first one above."
                      : "No invoices match these filters."}
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
