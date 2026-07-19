"use client";

import { useMemo, useState, useTransition } from "react";
import {
  exportLedgerAction,
  seedPortalCsvAction,
  seedPortalJsonAction,
  strikeLedgerEntryAction,
  backfillLedgersAction,
} from "@/actions/ledgers";
import { formatINR } from "@/lib/utils";

type Tab = "outward" | "inward" | "itc" | "advance" | "stock" | "audit" | "seed";

type Summary = {
  outwardCount: number;
  outwardTaxable: number;
  outwardGrand: number;
  outwardTax: number;
  inwardCount: number;
  inwardTaxable: number;
  itcTotal: number;
  itcCount: number;
  advanceBalance: number;
  maintainsStockLedger: boolean;
  retentionMonths: number;
};

export function LedgersClient({
  summary,
  outward,
  inward,
  itc,
  advance,
  audit,
  financialYear,
}: {
  summary: Summary;
  outward: Array<Record<string, unknown>>;
  inward: Array<Record<string, unknown>>;
  itc: Array<Record<string, unknown>>;
  advance: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  financialYear: string;
}) {
  const [tab, setTab] = useState<Tab>("outward");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [csvText, setCsvText] = useState("");
  const [seedKind, setSeedKind] = useState<"GSTR2B" | "GSTR1">("GSTR2B");
  const [gstEntity, setGstEntity] = useState<"ALL" | "DEL" | "RAJ">("ALL");

  const tabs: { id: Tab; label: string }[] = [
    { id: "outward", label: "Outward" },
    { id: "inward", label: "Inward" },
    { id: "itc", label: "ITC" },
    { id: "advance", label: "Advance" },
    { id: "stock", label: "Stock" },
    { id: "audit", label: "Audit" },
    { id: "seed", label: "Portal seed" },
  ];

  function downloadCsv(register: "outward" | "inward" | "itc" | "advance" | "stock" | "audit") {
    setErr("");
    start(async () => {
      try {
        const res = await exportLedgerAction({
          register,
          financialYear,
          gstEntity: gstEntity === "ALL" ? undefined : gstEntity,
        });
        const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.filename;
        a.click();
        URL.revokeObjectURL(url);
        setMsg(`Exported ${res.rowCount} ${register} rows`);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Export failed");
      }
    });
  }

  function strike(register: "outward" | "inward", id: string) {
    const reason = window.prompt("Strike-out reason (required):");
    if (!reason?.trim()) return;
    start(async () => {
      try {
        await strikeLedgerEntryAction({ register, id, reason });
        setMsg("Entry struck out");
        window.location.reload();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Strike failed");
      }
    });
  }

  const filteredOutward = useMemo(() => {
    if (gstEntity === "ALL") return outward;
    return outward.filter((r) => r.gstEntity === gstEntity);
  }, [outward, gstEntity]);

  const filteredInward = useMemo(() => {
    if (gstEntity === "ALL") return inward;
    return inward.filter((r) => r.gstEntity === gstEntity);
  }, [inward, gstEntity]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Outward docs", value: String(summary.outwardCount) },
          { label: "Outward tax", value: formatINR(summary.outwardTax) },
          { label: "ITC eligible", value: formatINR(summary.itcTotal) },
          { label: "Advance bal.", value: formatINR(summary.advanceBalance) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl p-3"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <p className="text-[0.6rem] uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
              {s.label}
            </p>
            <p className="text-lg font-semibold tabular-nums mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="text-xs px-3 py-1.5 rounded-lg font-semibold"
            style={{
              background: tab === t.id ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.03)",
              border: tab === t.id ? "1px solid rgba(251,191,36,0.4)" : "1px solid var(--border)",
              color: tab === t.id ? "#fbbf24" : "var(--text-muted)",
            }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <select
          className="input text-xs w-auto ml-auto"
          value={gstEntity}
          onChange={(e) => setGstEntity(e.target.value as "ALL" | "DEL" | "RAJ")}
        >
          <option value="ALL">All GST</option>
          <option value="DEL">DEL</option>
          <option value="RAJ">RAJ</option>
        </select>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          disabled={pending}
          onClick={() =>
            start(async () => {
              try {
                const r = await backfillLedgersAction();
                setMsg(`Backfilled ${r.invoices} invoices, ${r.expenses} expenses`);
                window.location.reload();
              } catch (e) {
                setErr(e instanceof Error ? e.message : "Backfill failed");
              }
            })
          }
        >
          Backfill from docs
        </button>
      </div>

      {msg && <p className="text-sm" style={{ color: "#34d399" }}>{msg}</p>}
      {err && <p className="text-sm" style={{ color: "var(--danger)" }}>{err}</p>}

      {tab === "outward" && (
        <RegisterTable
          title="Outward supply register"
          onExport={() => downloadCsv("outward")}
          pending={pending}
          rows={filteredOutward}
          columns={[
            ["documentNumber", "Doc #"],
            ["documentType", "Type"],
            ["documentDate", "Date"],
            ["buyerName", "Buyer"],
            ["buyerGstin", "GSTIN"],
            ["taxableValue", "Taxable"],
            ["grandTotal", "Total"],
            ["source", "Src"],
          ]}
          onStrike={(id) => strike("outward", id)}
        />
      )}

      {tab === "inward" && (
        <RegisterTable
          title="Inward supply register"
          onExport={() => downloadCsv("inward")}
          pending={pending}
          rows={filteredInward}
          columns={[
            ["billNumber", "Bill #"],
            ["billDate", "Date"],
            ["supplierName", "Supplier"],
            ["supplierGstin", "GSTIN"],
            ["taxableValue", "Taxable"],
            ["grandTotal", "Total"],
            ["itcEligible", "ITC"],
            ["source", "Src"],
          ]}
          onStrike={(id) => strike("inward", id)}
        />
      )}

      {tab === "itc" && (
        <RegisterTable
          title="ITC ledger"
          onExport={() => downloadCsv("itc")}
          pending={pending}
          rows={itc}
          columns={[
            ["periodYm", "Period"],
            ["status", "Status"],
            ["cgstAmount", "CGST"],
            ["sgstAmount", "SGST"],
            ["igstAmount", "IGST"],
            ["totalItc", "Total"],
            ["source", "Src"],
          ]}
        />
      )}

      {tab === "advance" && (
        <RegisterTable
          title="Advance ledger"
          onExport={() => downloadCsv("advance")}
          pending={pending}
          rows={advance}
          columns={[
            ["kind", "Kind"],
            ["documentNumber", "Doc #"],
            ["documentDate", "Date"],
            ["partyName", "Party"],
            ["amount", "Amount"],
            ["taxAmount", "Tax"],
          ]}
        />
      )}

      {tab === "stock" && (
        <div
          className="rounded-xl p-6 space-y-3"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <h3 className="font-semibold">Stock ledger</h3>
          {summary.maintainsStockLedger ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Stock movements will appear here when goods inventory is enabled.
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Not maintained — BluRidge consulting / services mode (
              <code>maintainsStockLedger=false</code>). Composition and service-only
              taxpayers typically do not require stock registers. Export still produces an
              explanatory CSV for officer handoff.
            </p>
          )}
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={pending}
            onClick={() => downloadCsv("stock")}
          >
            Export stock register CSV
          </button>
        </div>
      )}

      {tab === "audit" && (
        <RegisterTable
          title="Audit trail (Rule 56(8))"
          onExport={() => downloadCsv("audit")}
          pending={pending}
          rows={audit}
          columns={[
            ["createdAt", "At"],
            ["entityType", "Entity"],
            ["action", "Action"],
            ["entityId", "Id"],
            ["reason", "Reason"],
          ]}
        />
      )}

      {tab === "seed" && (
        <div
          className="rounded-xl p-5 space-y-4"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <h3 className="font-semibold">GST portal seed</h3>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Paste GSTR-2B (inward/ITC) or GSTR-1 (outward) JSON downloaded from the portal.
            CSV fallback columns: gstin,name,inum,idt,txval,cgst,sgst,igst,val,pos
          </p>
          <div className="flex gap-2">
            <select
              className="input w-auto"
              value={seedKind}
              onChange={(e) => setSeedKind(e.target.value as "GSTR2B" | "GSTR1")}
            >
              <option value="GSTR2B">GSTR-2B JSON</option>
              <option value="GSTR1">GSTR-1 JSON</option>
            </select>
          </div>
          <textarea
            className="input min-h-[140px] font-mono text-xs"
            placeholder="{ ... portal JSON ... }"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={pending || !jsonText.trim()}
            onClick={() =>
              start(async () => {
                try {
                  const r = await seedPortalJsonAction({
                    kind: seedKind,
                    jsonText,
                    gstEntity: gstEntity === "ALL" ? undefined : gstEntity,
                  });
                  setMsg(`Seeded ${r.created} ${r.kind} rows`);
                  window.location.reload();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "Seed failed");
                }
              })
            }
          >
            Import JSON
          </button>
          <textarea
            className="input min-h-[100px] font-mono text-xs"
            placeholder="CSV inward rows…"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-ghost text-xs"
            disabled={pending || !csvText.trim()}
            onClick={() =>
              start(async () => {
                try {
                  const r = await seedPortalCsvAction({
                    csvText,
                    gstEntity: gstEntity === "ALL" ? undefined : gstEntity,
                  });
                  setMsg(`Seeded ${r.created} CSV inward rows`);
                  window.location.reload();
                } catch (e) {
                  setErr(e instanceof Error ? e.message : "CSV seed failed");
                }
              })
            }
          >
            Import inward CSV
          </button>
        </div>
      )}

      <p className="text-[0.65rem]" style={{ color: "var(--text-dim)" }}>
        Retention policy: {summary.retentionMonths} months after annual-return due (heuristic).
        Ledger rows are never hard-deleted — strike with reason. Not legal advice.
      </p>
    </div>
  );
}

function RegisterTable({
  title,
  rows,
  columns,
  onExport,
  onStrike,
  pending,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  columns: [string, string][];
  onExport: () => void;
  onStrike?: (id: string) => void;
  pending: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        <button type="button" className="btn btn-ghost text-xs" disabled={pending} onClick={onExport}>
          Export CSV
        </button>
      </div>
      <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid var(--border)" }}>
        <table className="data">
          <thead>
            <tr>
              {columns.map(([, label]) => (
                <th key={label}>{label}</th>
              ))}
              {onStrike && <th></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                {columns.map(([key]) => (
                  <td key={key} className="text-sm">
                    {formatCell(r[key])}
                  </td>
                ))}
                {onStrike && (
                  <td>
                    {!r.struckOutAt && (
                      <button
                        type="button"
                        className="text-xs"
                        style={{ color: "#f87171" }}
                        onClick={() => onStrike(String(r.id))}
                      >
                        Strike
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (onStrike ? 1 : 0)} className="text-center py-8" style={{ color: "var(--text-dim)" }}>
                  No entries — backfill from docs or seed from portal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "Y" : "N";
  if (v instanceof Date) return v.toLocaleDateString("en-IN");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    return new Date(v).toLocaleDateString("en-IN");
  }
  if (typeof v === "number") return v.toLocaleString("en-IN");
  return String(v);
}
