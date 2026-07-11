"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice } from "@/actions/invoices";

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

type ClientOption = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  stateCode: string | null;
  gstin: string | null;
};

export function InvoiceForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerAddress, setBuyerAddress] = useState("");
  const [buyerGstin, setBuyerGstin] = useState("");
  const [buyerState, setBuyerState] = useState("Delhi");
  const [buyerStateCode, setBuyerStateCode] = useState("08");
  const [clientId, setClientId] = useState("");
  const [remarks, setRemarks] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [lines, setLines] = useState<Line[]>([
    { description: "Consultancy Service - TEV", hsn: "998313", quantity: 1, rate: 100000 },
  ]);

  function onClientChange(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setBuyerName(c.name);
    setBuyerAddress(
      [c.addressLine1, c.city, c.state].filter(Boolean).join(", "),
    );
    setBuyerGstin(c.gstin || "");
    setBuyerState(c.state || "Delhi");
    setBuyerStateCode(c.stateCode || "07");
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
          clientId: clientId || undefined,
          buyerName,
          buyerAddress,
          buyerGstin,
          buyerState,
          buyerStateCode,
          invoiceDate,
          remarks,
          lines,
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
        <div>
          <label className="label">Saved client</label>
          <select
            className="input"
            value={clientId}
            onChange={(e) => onClientChange(e.target.value)}
          >
            <option value="">— Manual entry —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Buyer name</label>
          <input
            className="input"
            required
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Buyer GSTIN</label>
          <input
            className="input"
            value={buyerGstin}
            onChange={(e) => setBuyerGstin(e.target.value)}
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
          <label className="label">State</label>
          <input
            className="input"
            value={buyerState}
            onChange={(e) => setBuyerState(e.target.value)}
          />
        </div>
        <div>
          <label className="label">State code</label>
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
