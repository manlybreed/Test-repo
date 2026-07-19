"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createInvoice,
  validateDraftAction,
  aiDraftInvoiceAction,
} from "@/actions/invoices";
import { GstEntitySelect } from "@/components/gst-entity-select";
import type { GstEntity } from "@/lib/gst-entities";
import type { InvoiceDocumentType } from "@/lib/invoice/types";

const PRESETS = [
  { description: "Consultancy Service - TEV", rate: 100000 },
  { description: "Consultancy Service - ROC", rate: 3500 },
  { description: "Consultancy Service - LEI", rate: 3500 },
  { description: "Consultancy Service - Cubic Tree", rate: 5000 },
  { description: "Document Charges (per month)", rate: 30000 },
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
  clientId?: string;
};

export function InvoiceForm({
  buyerSuggestions = [],
}: {
  buyerSuggestions?: BuyerSuggestion[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [buyerState, setBuyerState] = useState("Delhi");
  const [buyerStateCode, setBuyerStateCode] = useState("07");
  const [clientId, setClientId] = useState<string | undefined>();
  const [remarks, setRemarks] = useState("");
  const [gstEntity, setGstEntity] = useState<GstEntity>("DEL");
  const [documentType, setDocumentType] =
    useState<InvoiceDocumentType>("TAX_INVOICE");
  const [reverseCharge, setReverseCharge] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<Line[]>([
    { description: "Consultancy Service - TEV", hsn: "998313", quantity: 1, rate: 100000 },
  ]);

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
    setClientId(undefined);
    if (val.trim().length < 2) {
      setAcOpen(false);
      return;
    }
    const q = val.toLowerCase();
    const hits = buyerSuggestions.filter((s) =>
      s.name.toLowerCase().includes(q),
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
    setClientId(s.clientId);
    setAcOpen(false);
  }

  function addPreset(desc: string, rate: number) {
    setLines((prev) => [
      ...prev,
      { description: desc, hsn: "998313", quantity: 1, rate },
    ]);
  }

  function runAiDraft() {
    if (!aiPrompt.trim()) return;
    setError("");
    start(async () => {
      try {
        const draft = await aiDraftInvoiceAction(aiPrompt.trim());
        if (draft.buyerName) setBuyerName(draft.buyerName);
        if (draft.buyerAddress) setBuyerAddress(draft.buyerAddress);
        if (draft.buyerGstin) setBuyerGstin(draft.buyerGstin);
        if (draft.buyerState) setBuyerState(draft.buyerState);
        if (draft.buyerStateCode) setBuyerStateCode(draft.buyerStateCode);
        if (draft.gstEntity) setGstEntity(draft.gstEntity);
        if (draft.remarks) setRemarks(draft.remarks);
        if (draft.documentType === "PROFORMA" || draft.documentType === "TAX_INVOICE") {
          setDocumentType(draft.documentType);
        }
        if (draft.lines?.length) {
          setLines(
            draft.lines.map((l) => ({
              description: l.description,
              hsn: l.hsn || "998313",
              quantity: l.quantity ?? 1,
              rate: l.rate,
            })),
          );
        }
        if (draft.rationale) setWarnings([draft.rationale]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "AI draft failed");
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setWarnings([]);
    start(async () => {
      try {
        const validation = await validateDraftAction({
          documentType,
          buyerName,
          buyerGstin,
          buyerStateCode,
          placeOfSupplyStateCode: buyerStateCode,
          gstEntity,
          reverseCharge,
          remarks,
          lines,
          useAi: true,
        });
        if (!validation.canIssue) {
          setError(
            validation.issues
              .filter((i) => i.level === "error")
              .map((i) => i.message)
              .join(" "),
          );
          return;
        }
        setWarnings(
          validation.issues
            .filter((i) => i.level === "warning")
            .map((i) => i.message),
        );

        const res = await createInvoice({
          clientId,
          buyerName,
          buyerAddress,
          buyerGstin,
          buyerState,
          buyerStateCode,
          placeOfSupplyState: buyerState,
          placeOfSupplyStateCode: buyerStateCode,
          invoiceDate,
          remarks,
          lines,
          gstEntity,
          documentType,
          reverseCharge,
          status: "ISSUED",
        });
        const fileQ = res.filePath
          ? `&file=${encodeURIComponent(res.filePath)}`
          : "";
        router.push(
          `/ceo/invoices?created=${encodeURIComponent(res.number)}${fileQ}`,
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create invoice");
      }
    });
  }

  const isProforma = documentType === "PROFORMA";

  return (
    <form onSubmit={submit} className="space-y-6">
      <div>
        <p
          className="text-[0.65rem] tracking-[0.15em] uppercase font-semibold mb-2"
          style={{ color: "var(--text-dim)" }}
        >
          What are you creating?
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setDocumentType("TAX_INVOICE")}
            className="rounded-xl p-4 text-left transition-all"
            style={{
              background: !isProforma
                ? "rgba(251,191,36,0.12)"
                : "rgba(255,255,255,0.02)",
              border: !isProforma
                ? "1px solid rgba(251,191,36,0.45)"
                : "1px solid var(--border)",
            }}
          >
            <p
              className="text-sm font-semibold"
              style={{ color: !isProforma ? "#fbbf24" : "var(--text)" }}
            >
              Tax invoice
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              GST-compliant issued invoice with FY number (INV/…). Use when charging now.
            </p>
          </button>
          <button
            type="button"
            onClick={() => setDocumentType("PROFORMA")}
            className="rounded-xl p-4 text-left transition-all"
            style={{
              background: isProforma
                ? "rgba(129,140,248,0.14)"
                : "rgba(255,255,255,0.02)",
              border: isProforma
                ? "1px solid rgba(129,140,248,0.45)"
                : "1px solid var(--border)",
            }}
          >
            <p
              className="text-sm font-semibold"
              style={{ color: isProforma ? "#a5b4fc" : "var(--text)" }}
            >
              Proforma invoice
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              Not a tax invoice (PF/…). Issue now, convert to tax invoice later when ready to bill.
            </p>
          </button>
        </div>
      </div>

      <div
        className="rounded-xl p-4 space-y-2"
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
        }}
      >
        <p
          className="text-[0.65rem] tracking-[0.15em] uppercase font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          AI draft
        </p>
        <textarea
          className="input min-h-[64px]"
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder='e.g. "Proforma for Acme Solar, Delhi GST, token fee 40k for 2 plants under DEL"'
        />
        <button
          type="button"
          className="btn btn-ghost text-xs"
          disabled={pending || !aiPrompt.trim()}
          onClick={runAiDraft}
        >
          Fill form from AI
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Document date</label>
          <input
            className="input"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
          />
        </div>

        <div ref={acRef} className="relative sm:col-span-2 sm:max-w-sm">
          <label className="label">Buyer name</label>
          <input
            className="input"
            required
            autoComplete="off"
            value={buyerName}
            onChange={(e) => onBuyerNameChange(e.target.value)}
            onFocus={() => {
              if (buyerName.trim().length >= 2 && acResults.length > 0)
                setAcOpen(true);
            }}
            placeholder="Start typing to search…"
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
                  key={`${s.name}-${s.gstin}`}
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
                  <p
                    className="text-sm font-medium"
                    style={{ color: "rgba(255,255,255,0.92)" }}
                  >
                    {s.name}
                  </p>
                  <p
                    className="text-xs mt-0.5 truncate"
                    style={{ color: "rgba(255,255,255,0.45)" }}
                  >
                    {[s.gstin, s.address].filter(Boolean).join(" · ")}
                  </p>
                </button>
              ))}
            </div>
          )}
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
            placeholder="Required for B2B; checksum validated"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Buyer address</label>
          <input
            className="input"
            value={buyerAddress}
            onChange={(e) => setBuyerAddress(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Place of supply / buyer state</label>
          <input
            className="input"
            value={buyerState}
            onChange={(e) => setBuyerState(e.target.value)}
          />
        </div>
        <div>
          <label className="label">State code (POS)</label>
          <input
            className="input"
            value={buyerStateCode}
            onChange={(e) => setBuyerStateCode(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2 flex items-center gap-2">
          <input
            id="rcm"
            type="checkbox"
            checked={reverseCharge}
            onChange={(e) => setReverseCharge(e.target.checked)}
          />
          <label htmlFor="rcm" className="text-sm" style={{ color: "var(--text-muted)" }}>
            Reverse charge applicable
          </label>
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
          onClick={() =>
            setLines([
              ...lines,
              { description: "", hsn: "998313", quantity: 1, rate: 0 },
            ])
          }
        >
          + Add line
        </button>
      </div>

      {warnings.length > 0 && (
        <ul className="text-sm space-y-1" style={{ color: "#fbbf24" }}>
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending
          ? "Issuing…"
          : documentType === "PROFORMA"
            ? "Issue proforma"
            : "Issue tax invoice"}
      </button>
    </form>
  );
}
