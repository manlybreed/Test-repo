"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "@/actions/invoices";
import { GstEntitySelect } from "@/components/gst-entity-select";
import type { GstEntity } from "@/lib/gst-entities";

const PRESETS = [
  { description: "Consultancy Service - TEV", rate: 100000 },
  { description: "Consultancy Service - ROC", rate: 3500 },
  { description: "Consultancy Service - LEI", rate: 3500 },
  { description: "Consultancy Service - Cubic Tree", rate: 5000 },
  { description: "Engagement Token - PM KUSUM", rate: 40000 },
  { description: "Success Fee M1 - PM KUSUM", rate: 0 },
  { description: "Success Fee M2 - PM KUSUM", rate: 0 },
];

type Line = { description: string; hsn: string; quantity: number; rate: number };

type BuyerSuggestion = {
  name: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
};

export function InvoiceForm({
  buyerSuggestions = [],
}: {
  buyerSuggestions?: BuyerSuggestion[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [buyerState, setBuyerState] = useState("Delhi");
  const [buyerStateCode, setBuyerStateCode] = useState("07");
  const [remarks, setRemarks] = useState("");
  const [gstEntity, setGstEntity] = useState<GstEntity>("DEL");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<Line[]>([
    { description: "Consultancy Service - TEV", hsn: "998313", quantity: 1, rate: 100000 },
  ]);

  // Autocomplete state
  const [acOpen, setAcOpen] = useState(false);
  const [acResults, setAcResults] = useState<BuyerSuggestion[]>([]);
  const acRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (acRef.current && !acRef.current.contains(e.target as Node)) {
        setAcOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function onBuyerNameChange(val: string) {
    setBuyerName(val);
    if (val.trim().length < 2) {
      setAcOpen(false);
      return;
    }
    const q = val.toLowerCase();
    const hits = buyerSuggestions.filter((s) =>
      s.name.toLowerCase().includes(q)
    );
    setAcResults(hits);
    setAcOpen(hits.length > 0);
  }

  function applyBuyerSuggestion(s: BuyerSuggestion) {
    setBuyerName(s.name);
    setBuyerGstin(s.gstin);
    setBuyerAddress(s.address);
    setBuyerState(s.state || "Delhi");
    setBuyerStateCode(s.stateCode || "07");
    setAcOpen(false);
  }

  function addPreset(desc: string, rate: number) {
    setLines((prev) => [
      ...prev,
      { description: desc, hsn: "998313", quantity: 1, rate },
    ]);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      try {
        const res = await createInvoice({
          buyerName,
          buyerAddress,
          buyerGstin,
          buyerState,
          buyerStateCode,
          invoiceDate,
          remarks,
          lines,
          gstEntity,
        });
        router.push(`/ceo/invoices?created=${res.number}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create invoice");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Buyer name with autocomplete */}
        <div ref={acRef} className="relative sm:col-span-2 sm:max-w-sm">
          <label className="label">Buyer name</label>
          <input
            className="input"
            required
            autoComplete="off"
            value={buyerName}
            onChange={(e) => onBuyerNameChange(e.target.value)}
            onFocus={() => {
              if (buyerName.trim().length >= 2 && acResults.length > 0) setAcOpen(true);
            }}
            placeholder="Start typing to search from past records…"
          />
          {acOpen && acResults.length > 0 && (
            <div
              className="absolute top-full left-0 right-0 z-[60] rounded-xl overflow-hidden mt-1"
              style={{
                background: "rgba(18, 22, 34, 0.72)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: "0 16px 40px rgba(0,0,0,0.45)",
              }}
            >
              {acResults.slice(0, 8).map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className="w-full text-left px-4 py-2.5 transition-colors"
                  style={{ background: "transparent" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(99,102,241,0.18)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                  onClick={() => applyBuyerSuggestion(s)}
                >
                  <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.92)" }}>
                    {s.name}
                  </p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "rgba(255,255,255,0.45)" }}>
                    {[s.gstin, s.address].filter(Boolean).join(" · ")}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="label">Invoice date</label>
          <input
            className="input"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <GstEntitySelect
            value={gstEntity}
            onChange={setGstEntity}
            label="Raised under BluRidge GST"
          />
        </div>

        <div>
          <label className="label">Buyer GSTIN</label>
          <input
            className="input"
            value={buyerGstin}
            onChange={(e) => setBuyerGstin(e.target.value)}
            placeholder="Auto-filled when buyer selected"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Buyer address</label>
          <input
            className="input"
            value={buyerAddress}
            onChange={(e) => setBuyerAddress(e.target.value)}
            placeholder="Auto-filled when buyer selected"
          />
        </div>
        <div>
          <label className="label">Buyer state</label>
          <input
            className="input"
            value={buyerState}
            onChange={(e) => setBuyerState(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Buyer state code</label>
          <input
            className="input"
            value={buyerStateCode}
            onChange={(e) => setBuyerStateCode(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Remarks / SPV</label>
          <input
            className="input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g. SPV-SAKARWADA SOLAR ENERGY LTD"
          />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-xs text-dim uppercase tracking-wider self-center mr-1">
            Presets
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.description}
              type="button"
              className="btn btn-ghost text-xs py-1"
              onClick={() => addPreset(p.description, p.rate)}
            >
              {p.description.replace("Consultancy Service - ", "")}
            </button>
          ))}
        </div>

        <div className="panel overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>Description</th>
                <th>HSN</th>
                <th>Qty</th>
                <th>Rate</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="input"
                      value={line.description}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...line, description: e.target.value };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="w-24">
                    <input
                      className="input"
                      value={line.hsn}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...line, hsn: e.target.value };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="w-20">
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...line, quantity: Number(e.target.value) };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="w-32">
                    <input
                      className="input"
                      type="number"
                      min={0}
                      value={line.rate}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...line, rate: Number(e.target.value) };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="w-16">
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-ghost text-xs mt-2"
          onClick={() => setLines([...lines, { description: "", hsn: "998313", quantity: 1, rate: 0 }])}
        >
          + Add line
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Generating…" : "Generate tax invoice"}
      </button>
    </form>
  );
}
