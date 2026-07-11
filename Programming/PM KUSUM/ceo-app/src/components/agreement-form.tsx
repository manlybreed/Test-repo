"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgreement } from "@/actions/agreements";
import { motion, AnimatePresence } from "framer-motion";

type ClientOption = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  pan: string | null;
};

const STEPS = [
  { id: "client", label: "Client" },
  { id: "commercial", label: "Fees" },
  { id: "financing", label: "Financing" },
  { id: "project", label: "Project" },
];

export function AgreementForm({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState("");
  const [form, setForm] = useState({
    clientName: "",
    clientAddress: "",
    clientGstin: "",
    clientPan: "",
    clientEmail: "",
    clientMobile: "",
    spvName: "",
    plantCount: 1,
    tokenFeePerPlant: 40000,
    successFeePct: 1,
    gstPct: 18,
    designatedLender: "",
    loanType: "Term Loan / CGTMSE-backed",
    interestMin: "",
    interestMax: "",
    minLoan: "",
    maxLoan: "",
    tenure: "",
    moratorium: "",
    repaymentSchedule: "Monthly EMI",
    collateral: "Registered Lease Deed of project land, SPV assets, personal guarantee of Promoters",
    plantCapacityAC: "2",
    plantCapacityDC: "",
    tariff: "",
    dprAmount: "",
    effectiveDate: new Date().toISOString().slice(0, 10),
    status: "FINAL" as "DRAFT" | "FINAL",
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onClientChange(id: string) {
    setClientId(id);
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    setForm((f) => ({
      ...f,
      clientName: c.name,
      clientAddress: [c.addressLine1, c.city, c.state].filter(Boolean).join(", "),
      clientGstin: c.gstin || "",
      clientPan: c.pan || "",
    }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      try {
        const res = await createAgreement({ ...form, clientId: clientId || undefined });
        router.push(`/ceo/agreements?created=${res.id}`);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
        setStep(0);
      }
    });
  }

  const stepVariants = {
    hidden: { opacity: 0, x: 32 },
    visible: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -32 },
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-2">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(i)}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center border text-[10px] font-semibold transition-all"
              style={{
                background: i <= step ? "var(--navy)" : "transparent",
                borderColor: i <= step ? "var(--navy-bright)" : "var(--border)",
                color: i <= step ? "#fff" : "var(--text-dim)",
              }}
            >
              {i + 1}
            </span>
            <span style={{ color: i === step ? "var(--text)" : "var(--text-dim)" }}>
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="w-6 h-px mx-1" style={{ background: "var(--border)" }} />
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div
            key="client"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="grid sm:grid-cols-2 gap-4"
          >
            <div>
              <label className="label">Saved client</label>
              <select className="input" value={clientId} onChange={(e) => onClientChange(e.target.value)}>
                <option value="">— Manual entry —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Effective date</label>
              <input className="input" type="date" value={form.effectiveDate} onChange={(e) => set("effectiveDate", e.target.value)} />
            </div>
            <div>
              <label className="label">Client / company legal name <span style={{ color: "var(--danger)" }}>*</span></label>
              <input className="input" required value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="e.g. BSS ECO SOLAR PRIVATE LIMITED" />
            </div>
            <div>
              <label className="label">SPV / project entity</label>
              <input className="input" value={form.spvName} onChange={(e) => set("spvName", e.target.value)} placeholder="e.g. SAKARWADA SOLAR ENERGY LTD" />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Registered / communication address</label>
              <input className="input" value={form.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} placeholder="Block A, Sector 12, Noida, Uttar Pradesh 201301" />
            </div>
            <div>
              <label className="label">Client GSTIN</label>
              <input className="input" value={form.clientGstin} onChange={(e) => set("clientGstin", e.target.value)} />
            </div>
            <div>
              <label className="label">Client PAN / CIN</label>
              <input className="input" value={form.clientPan} onChange={(e) => set("clientPan", e.target.value)} />
            </div>
            <div>
              <label className="label">Client email</label>
              <input className="input" type="email" value={form.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} />
            </div>
            <div>
              <label className="label">Client mobile</label>
              <input className="input" type="tel" value={form.clientMobile} onChange={(e) => set("clientMobile", e.target.value)} />
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="commercial" variants={stepVariants} initial="hidden" animate="visible" exit="exit" transition={{ duration: 0.22 }} className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="label">Plant count</label>
              <input className="input" type="number" min={1} value={form.plantCount} onChange={(e) => set("plantCount", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Token fee / plant (₹)</label>
              <input className="input" type="number" value={form.tokenFeePerPlant} onChange={(e) => set("tokenFeePerPlant", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Success fee %</label>
              <input className="input" type="number" step="0.01" value={form.successFeePct} onChange={(e) => set("successFeePct", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">GST %</label>
              <input className="input" type="number" value={form.gstPct} onChange={(e) => set("gstPct", Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={(e) => set("status", e.target.value as "DRAFT" | "FINAL")}>
                <option value="FINAL">Final</option>
                <option value="DRAFT">Draft</option>
              </select>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="financing" variants={stepVariants} initial="hidden" animate="visible" exit="exit" transition={{ duration: 0.22 }} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Designated lender</label>
              <input className="input" value={form.designatedLender} onChange={(e) => set("designatedLender", e.target.value)} placeholder="e.g. SBI / PNB / RGB" />
            </div>
            <div>
              <label className="label">Loan type</label>
              <input className="input" value={form.loanType} onChange={(e) => set("loanType", e.target.value)} placeholder="Term Loan / CGTMSE-backed" />
            </div>
            <div>
              <label className="label">Interest min (% p.a.)</label>
              <input className="input" value={form.interestMin} onChange={(e) => set("interestMin", e.target.value)} placeholder="9" />
            </div>
            <div>
              <label className="label">Interest max (% p.a.)</label>
              <input className="input" value={form.interestMax} onChange={(e) => set("interestMax", e.target.value)} placeholder="12" />
            </div>
            <div>
              <label className="label">Minimum loan (INR)</label>
              <input className="input" value={form.minLoan} onChange={(e) => set("minLoan", e.target.value)} placeholder="1,00,00,000" />
            </div>
            <div>
              <label className="label">Maximum loan (INR)</label>
              <input className="input" value={form.maxLoan} onChange={(e) => set("maxLoan", e.target.value)} placeholder="1,80,00,000" />
            </div>
            <div>
              <label className="label">Tenure (years)</label>
              <input className="input" value={form.tenure} onChange={(e) => set("tenure", e.target.value)} placeholder="15" />
            </div>
            <div>
              <label className="label">Moratorium (months)</label>
              <input className="input" value={form.moratorium} onChange={(e) => set("moratorium", e.target.value)} placeholder="12" />
            </div>
            <div>
              <label className="label">Repayment schedule</label>
              <input className="input" value={form.repaymentSchedule} onChange={(e) => set("repaymentSchedule", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Collateral description</label>
              <input className="input" value={form.collateral} onChange={(e) => set("collateral", e.target.value)} />
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="project" variants={stepVariants} initial="hidden" animate="visible" exit="exit" transition={{ duration: 0.22 }} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Plant capacity AC (MW)</label>
              <input className="input" value={form.plantCapacityAC} onChange={(e) => set("plantCapacityAC", e.target.value)} placeholder="2" />
            </div>
            <div>
              <label className="label">Plant capacity DC (MW)</label>
              <input className="input" value={form.plantCapacityDC} onChange={(e) => set("plantCapacityDC", e.target.value)} placeholder="2.5" />
            </div>
            <div>
              <label className="label">PPA tariff (₹ per kWh)</label>
              <input className="input" value={form.tariff} onChange={(e) => set("tariff", e.target.value)} placeholder="3.14" />
            </div>
            <div>
              <label className="label">DPR project cost (INR)</label>
              <input className="input" value={form.dprAmount} onChange={(e) => set("dprAmount", e.target.value)} placeholder="2,25,00,000" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
      )}

      <div className="flex items-center justify-between pt-2">
        {step > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>
            ← Back
          </button>
        ) : <span />}

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (step === 0 && !form.clientName.trim()) {
                setError("Client name is required");
                return;
              }
              setError("");
              setStep(s => s + 1);
            }}
          >
            Next →
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? (
              <span className="flex items-center gap-2">
                <span className="loading-spin" /> Generating DOCX…
              </span>
            ) : "Generate agreement (DOCX)"}
          </button>
        )}
      </div>
    </form>
  );
}
