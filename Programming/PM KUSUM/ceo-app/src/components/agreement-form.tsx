"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAgreement, updateAgreement } from "@/actions/agreements";
import { BuyerForm } from "@/components/buyer-form";
import { ConfirmModifyDialog } from "@/components/confirm-dialogs";
import { motion, AnimatePresence } from "framer-motion";

type ClientOption = {
  id: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  pan: string | null;
  phone?: string | null;
  pocName?: string | null;
  email?: string | null;
  agreementCount?: number;
};

export type AgreementEditSeed = {
  id: string;
  clientId?: string | null;
  clientName: string;
  clientAddress?: string | null;
  clientGstin?: string | null;
  clientPan?: string | null;
  clientEmail?: string;
  clientMobile?: string;
  spvName?: string | null;
  plantCount?: number;
  tokenFeePerPlant?: number;
  successFeePct?: number;
  gstPct?: number;
  designatedLender?: string | null;
  loanType?: string;
  interestMin?: string;
  interestMax?: string;
  minLoan?: string;
  maxLoan?: string;
  tenure?: string;
  moratorium?: string;
  repaymentSchedule?: string;
  collateral?: string;
  plantCapacityAC?: string;
  plantCapacityDC?: string;
  tariff?: string;
  dprAmount?: string;
  effectiveDate?: string;
  status?: "DRAFT" | "FINAL";
};

const STEPS = [
  { id: "client", label: "Client" },
  { id: "commercial", label: "Fees" },
  { id: "financing", label: "Financing" },
  { id: "project", label: "Project" },
];

function emptyForm() {
  return {
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
    collateral:
      "Registered Lease Deed of project land, SPV assets, personal guarantee of Promoters",
    plantCapacityAC: "2",
    plantCapacityDC: "",
    tariff: "",
    dprAmount: "",
    effectiveDate: new Date().toISOString().slice(0, 10),
    status: "FINAL" as "DRAFT" | "FINAL",
  };
}

function seedToForm(seed: AgreementEditSeed) {
  const base = emptyForm();
  return {
    ...base,
    clientName: seed.clientName || "",
    clientAddress: seed.clientAddress || "",
    clientGstin: seed.clientGstin || "",
    clientPan: seed.clientPan || "",
    clientEmail: seed.clientEmail || "",
    clientMobile: seed.clientMobile || "",
    spvName: seed.spvName || "",
    plantCount: seed.plantCount ?? 1,
    tokenFeePerPlant: seed.tokenFeePerPlant ?? 40000,
    successFeePct: seed.successFeePct ?? 1,
    gstPct: seed.gstPct ?? 18,
    designatedLender: seed.designatedLender || "",
    loanType: seed.loanType || base.loanType,
    interestMin: seed.interestMin || "",
    interestMax: seed.interestMax || "",
    minLoan: seed.minLoan || "",
    maxLoan: seed.maxLoan || "",
    tenure: seed.tenure || "",
    moratorium: seed.moratorium || "",
    repaymentSchedule: seed.repaymentSchedule || base.repaymentSchedule,
    collateral: seed.collateral || base.collateral,
    plantCapacityAC: seed.plantCapacityAC || "",
    plantCapacityDC: seed.plantCapacityDC || "",
    tariff: seed.tariff || "",
    dprAmount: seed.dprAmount || "",
    effectiveDate: seed.effectiveDate
      ? seed.effectiveDate.slice(0, 10)
      : base.effectiveDate,
    status: seed.status || "FINAL",
  };
}

export function AgreementForm({
  clients: initialClients,
  initialClientId,
  editing = null,
  onCancelEdit,
}: {
  clients: ClientOption[];
  initialClientId?: string;
  editing?: AgreementEditSeed | null;
  onCancelEdit?: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(editing?.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const [clientId, setClientId] = useState(
    editing?.clientId || initialClientId || "",
  );
  const [clients, setClients] = useState(initialClients);
  const [showNewClient, setShowNewClient] = useState(false);
  const [confirmModify, setConfirmModify] = useState(false);
  const [form, setForm] = useState(() =>
    editing ? seedToForm(editing) : emptyForm(),
  );

  useEffect(() => {
    setClients(initialClients);
  }, [initialClients]);

  useEffect(() => {
    if (editing) {
      setForm(seedToForm(editing));
      setClientId(editing.clientId || "");
      setStep(0);
      return;
    }
    if (!initialClientId) return;
    const c = initialClients.find((x) => x.id === initialClientId);
    if (c) applyClient(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialClientId, editing?.id]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function applyClient(c: ClientOption) {
    setClientId(c.id);
    setForm((f) => ({
      ...f,
      clientName: c.name,
      clientAddress: [c.addressLine1, c.city, c.state].filter(Boolean).join(", "),
      clientGstin: c.gstin || "",
      clientPan: c.pan || "",
      clientEmail: c.email || f.clientEmail,
      clientMobile: c.phone || f.clientMobile,
    }));
  }

  function onClientChange(id: string) {
    if (!id) {
      setClientId("");
      return;
    }
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    applyClient(c);
  }

  function onClientCreated(client: ClientOption) {
    setClients((prev) => {
      if (prev.some((c) => c.id === client.id)) return prev;
      return [
        ...prev,
        { ...client, agreementCount: client.agreementCount ?? 0 },
      ].sort((a, b) => a.name.localeCompare(b.name));
    });
    applyClient(client);
    setShowNewClient(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (isEdit) {
      setConfirmModify(true);
      return;
    }
    void saveAgreement();
  }

  async function saveAgreement() {
    setConfirmModify(false);
    start(async () => {
      try {
        const payload = { ...form, clientId: clientId || undefined };
        const res = isEdit && editing?.id
          ? await updateAgreement(editing.id, payload)
          : await createAgreement(payload);
        onCancelEdit?.();
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

  const selected = clients.find((c) => c.id === clientId);
  const existingCount = selected?.agreementCount ?? 0;

  return (
    <form onSubmit={submit} className="space-y-6">
      {isEdit && (
        <div
          className="rounded-xl px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap"
          style={{
            background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(129,140,248,0.35)",
            color: "#c7d2fe",
          }}
        >
          <p className="font-semibold">
            Editing agreement for {form.clientName} — saves as a new DOCX version
          </p>
          {onCancelEdit && (
            <button type="button" className="btn btn-ghost text-xs py-1" onClick={onCancelEdit}>
              Cancel edit
            </button>
          )}
        </div>
      )}

      {!isEdit && initialClientId && selected && (
        <div
          className="rounded-xl px-4 py-3 text-sm space-y-1"
          style={{
            background:
              existingCount > 0
                ? "rgba(245,158,11,0.08)"
                : "rgba(99,102,241,0.08)",
            border: `1px solid ${
              existingCount > 0
                ? "rgba(245,158,11,0.3)"
                : "rgba(99,102,241,0.25)"
            }`,
            color: existingCount > 0 ? "#fcd34d" : "#c7d2fe",
          }}
        >
          <p className="font-semibold">
            Creating agreement for {selected.name}
            {selected.pocName ? ` · PoC ${selected.pocName}` : ""}
            {selected.phone ? ` · ${selected.phone}` : ""}
          </p>
          {existingCount > 0 ? (
            <p className="text-xs" style={{ color: "rgba(253,230,138,0.9)" }}>
              This client already has {existingCount} agreement
              {existingCount === 1 ? "" : "s"} in the library. Generating again
              creates a <strong>new</strong> mandate — existing DOCX files stay
              untouched.
            </p>
          ) : (
            <p className="text-xs" style={{ color: "rgba(199,210,254,0.85)" }}>
              No prior agreement on file for this client — fill fees and generate.
            </p>
          )}
        </div>
      )}

      {!isEdit && !initialClientId && existingCount > 0 && selected && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{
            background: "rgba(245,158,11,0.08)",
            border: "1px solid rgba(245,158,11,0.3)",
            color: "#fcd34d",
          }}
        >
          {selected.name} already has {existingCount} agreement
          {existingCount === 1 ? "" : "s"}. Creating another adds a new file —
          existing ones remain in the library below.
        </div>
      )}

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
            className="space-y-4"
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="label !mb-0">Saved client</label>
                  <button
                    type="button"
                    className="text-[0.7rem] font-semibold underline"
                    style={{ color: "#a5b4fc" }}
                    onClick={() => setShowNewClient((v) => !v)}
                  >
                    {showNewClient ? "Cancel" : "+ Add new client"}
                  </button>
                </div>
                <select
                  className="input"
                  value={clientId}
                  onChange={(e) => onClientChange(e.target.value)}
                  disabled={showNewClient}
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
                <label className="label">Effective date</label>
                <input
                  className="input"
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) => set("effectiveDate", e.target.value)}
                />
              </div>
            </div>

            {showNewClient && (
              <div
                className="rounded-xl p-4"
                style={{
                  background: "rgba(99,102,241,0.06)",
                  border: "1px solid rgba(99,102,241,0.2)",
                }}
              >
                <p className="text-sm font-semibold mb-3">Add new client</p>
                <BuyerForm embedded onCreated={onClientCreated} />
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">
                  Client / company legal name{" "}
                  <span style={{ color: "var(--danger)" }}>*</span>
                </label>
                <input
                  className="input"
                  required
                  value={form.clientName}
                  onChange={(e) => set("clientName", e.target.value)}
                  placeholder="e.g. BSS ECO SOLAR PRIVATE LIMITED"
                />
              </div>
              <div>
                <label className="label">SPV / project entity</label>
                <input
                  className="input"
                  value={form.spvName}
                  onChange={(e) => set("spvName", e.target.value)}
                  placeholder="e.g. SAKARWADA SOLAR ENERGY LTD"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Registered / communication address</label>
                <input
                  className="input"
                  value={form.clientAddress}
                  onChange={(e) => set("clientAddress", e.target.value)}
                  placeholder="Block A, Sector 12, Noida, Uttar Pradesh 201301"
                />
              </div>
              <div>
                <label className="label">Client GSTIN</label>
                <input
                  className="input"
                  value={form.clientGstin}
                  onChange={(e) => set("clientGstin", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Client PAN / CIN</label>
                <input
                  className="input"
                  value={form.clientPan}
                  onChange={(e) => set("clientPan", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Client email</label>
                <input
                  className="input"
                  type="email"
                  value={form.clientEmail}
                  onChange={(e) => set("clientEmail", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Client mobile (PoC)</label>
                <input
                  className="input"
                  type="tel"
                  value={form.clientMobile}
                  onChange={(e) => set("clientMobile", e.target.value)}
                />
              </div>
              {selected?.pocName && (
                <div className="sm:col-span-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  PoC on file: <span className="font-medium" style={{ color: "var(--text)" }}>{selected.pocName}</span>
                  {selected.phone ? ` · ${selected.phone}` : ""}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="commercial"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="grid sm:grid-cols-3 gap-4"
          >
            <div>
              <label className="label">Plant count</label>
              <input
                className="input"
                type="number"
                min={1}
                value={form.plantCount}
                onChange={(e) => set("plantCount", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Token fee / plant (₹)</label>
              <input
                className="input"
                type="number"
                value={form.tokenFeePerPlant}
                onChange={(e) => set("tokenFeePerPlant", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Success fee %</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={form.successFeePct}
                onChange={(e) => set("successFeePct", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">GST %</label>
              <input
                className="input"
                type="number"
                value={form.gstPct}
                onChange={(e) => set("gstPct", Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Status</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => set("status", e.target.value as "DRAFT" | "FINAL")}
              >
                <option value="FINAL">Final</option>
                <option value="DRAFT">Draft</option>
              </select>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="financing"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="grid sm:grid-cols-2 gap-4"
          >
            <div>
              <label className="label">Designated lender</label>
              <input
                className="input"
                value={form.designatedLender}
                onChange={(e) => set("designatedLender", e.target.value)}
                placeholder="e.g. SBI / PNB / RGB"
              />
            </div>
            <div>
              <label className="label">Loan type</label>
              <input
                className="input"
                value={form.loanType}
                onChange={(e) => set("loanType", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Interest min %</label>
              <input
                className="input"
                value={form.interestMin}
                onChange={(e) => set("interestMin", e.target.value)}
                placeholder="9.5"
              />
            </div>
            <div>
              <label className="label">Interest max %</label>
              <input
                className="input"
                value={form.interestMax}
                onChange={(e) => set("interestMax", e.target.value)}
                placeholder="12"
              />
            </div>
            <div>
              <label className="label">Min loan (₹)</label>
              <input
                className="input"
                value={form.minLoan}
                onChange={(e) => set("minLoan", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Max loan (₹)</label>
              <input
                className="input"
                value={form.maxLoan}
                onChange={(e) => set("maxLoan", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Tenure</label>
              <input
                className="input"
                value={form.tenure}
                onChange={(e) => set("tenure", e.target.value)}
                placeholder="15 years"
              />
            </div>
            <div>
              <label className="label">Moratorium</label>
              <input
                className="input"
                value={form.moratorium}
                onChange={(e) => set("moratorium", e.target.value)}
              />
            </div>
            <div>
              <label className="label">Repayment schedule</label>
              <input
                className="input"
                value={form.repaymentSchedule}
                onChange={(e) => set("repaymentSchedule", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Collateral description</label>
              <input
                className="input"
                value={form.collateral}
                onChange={(e) => set("collateral", e.target.value)}
              />
            </div>
          </motion.div>
        )}

        {step === 3 && (
          <motion.div
            key="project"
            variants={stepVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22 }}
            className="grid sm:grid-cols-2 gap-4"
          >
            <div>
              <label className="label">Plant capacity AC (MW)</label>
              <input
                className="input"
                value={form.plantCapacityAC}
                onChange={(e) => set("plantCapacityAC", e.target.value)}
                placeholder="2"
              />
            </div>
            <div>
              <label className="label">Plant capacity DC (MW)</label>
              <input
                className="input"
                value={form.plantCapacityDC}
                onChange={(e) => set("plantCapacityDC", e.target.value)}
                placeholder="2.5"
              />
            </div>
            <div>
              <label className="label">PPA tariff (₹ per kWh)</label>
              <input
                className="input"
                value={form.tariff}
                onChange={(e) => set("tariff", e.target.value)}
                placeholder="3.14"
              />
            </div>
            <div>
              <label className="label">DPR project cost (INR)</label>
              <input
                className="input"
                value={form.dprAmount}
                onChange={(e) => set("dprAmount", e.target.value)}
                placeholder="2,25,00,000"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="flex items-center justify-between pt-2">
        {step > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setStep((s) => s - 1)}
          >
            ← Back
          </button>
        ) : (
          <span />
        )}

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
              setStep((s) => s + 1);
            }}
          >
            Next →
          </button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? (
              <span className="flex items-center gap-2">
                <span className="loading-spin" />{" "}
                {isEdit ? "Saving DOCX…" : "Generating DOCX…"}
              </span>
            ) : isEdit ? (
              "Save & regenerate DOCX"
            ) : (
              "Generate agreement (DOCX)"
            )}
          </button>
        )}
      </div>

      <ConfirmModifyDialog
        open={confirmModify}
        title="Update agreement?"
        description="A new DOCX version will be generated. Previous versions stay in history; the library link points to the latest file."
        pending={pending}
        onCancel={() => setConfirmModify(false)}
        onConfirm={() => void saveAgreement()}
      />
    </form>
  );
}
