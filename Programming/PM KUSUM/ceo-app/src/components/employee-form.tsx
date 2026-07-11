"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployee, nextEmployeeCode, upsertEmployee } from "@/actions/payroll";
import { employeeSalaryTotals } from "@/lib/employee-salary";
import { formatAadhaar } from "@/lib/indian-states";
import { ConfirmModifyDialog } from "@/components/confirm-dialogs";

export type EmployeeFormData = {
  name: string;
  employeeCode: string;
  designation: string;
  department: string;
  email: string;
  emailOfficial: string;
  phone: string;
  pan: string;
  aadhaar: string;
  uan: string;
  addressLine1: string;
  city: string;
  state: string;
  pincode: string;
  bankAccount: string;
  bankIfsc: string;
  bankName: string;
  bankBranch: string;
  basic: string;
  hra: string;
  special: string;
  otherAllow: string;
  pf: string;
  professionalTax: string;
  tdsPercent: string;
  otherDeduct: string;
  joinDate: string;
  notes: string;
};

const EMPTY: EmployeeFormData = {
  name: "",
  employeeCode: "",
  designation: "",
  department: "",
  email: "",
  emailOfficial: "",
  phone: "",
  pan: "",
  aadhaar: "",
  uan: "",
  addressLine1: "",
  city: "",
  state: "",
  pincode: "",
  bankAccount: "",
  bankIfsc: "",
  bankName: "",
  bankBranch: "",
  basic: "",
  hra: "0",
  special: "0",
  otherAllow: "0",
  pf: "0",
  professionalTax: "0",
  tdsPercent: "0",
  otherDeduct: "0",
  joinDate: "",
  notes: "",
};

const TDS_PRESETS = [0, 5, 10, 20] as const;

export type EmployeeEditSeed = {
  id: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  email: string | null;
  emailOfficial: string | null;
  phone: string | null;
  pan: string | null;
  aadhaar: string | null;
  uan: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  bankBranch: string | null;
  basic: number;
  hra: number;
  special: number;
  otherAllow: number;
  pf: number;
  professionalTax: number;
  tdsPercent: number;
  otherDeduct: number;
  joinDate: string | null;
  notes: string | null;
  photoPath: string | null;
  panDocPath: string | null;
  aadhaarDocPath: string | null;
  agreementPath: string | null;
  bankDocPath: string | null;
  salarySlipPath: string | null;
};

function seedToForm(e: EmployeeEditSeed): EmployeeFormData {
  return {
    name: e.name,
    employeeCode: e.employeeCode ?? "",
    designation: e.designation ?? "",
    department: e.department ?? "",
    email: e.email ?? "",
    emailOfficial: e.emailOfficial ?? "",
    phone: e.phone ?? "",
    pan: e.pan ?? "",
    aadhaar: e.aadhaar ? formatAadhaar(e.aadhaar) : "",
    uan: e.uan ?? "",
    addressLine1: e.addressLine1 ?? "",
    city: e.city ?? "",
    state: e.state ?? "",
    pincode: e.pincode ?? "",
    bankAccount: e.bankAccount ?? "",
    bankIfsc: e.bankIfsc ?? "",
    bankName: e.bankName ?? "",
    bankBranch: e.bankBranch ?? "",
    basic: String(e.basic),
    hra: String(e.hra),
    special: String(e.special),
    otherAllow: String(e.otherAllow),
    pf: String(e.pf),
    professionalTax: String(e.professionalTax),
    tdsPercent: String(e.tdsPercent),
    otherDeduct: String(e.otherDeduct),
    joinDate: e.joinDate ?? "",
    notes: e.notes ?? "",
  };
}

type DocKind = "pending" | "pan" | "aadhaar" | "photo" | "salary" | "agreement" | "bank" | "other";

type DocItem = {
  id: string;
  file: File;
  kind: DocKind;
  filePath?: string;
  status: "queued" | "uploading" | "ready" | "error";
  error?: string;
  classifyConfidence?: number;
  classifyReason?: string;
};

type Mode = "manual" | "documents";

const AI_KIND_TO_DOC: Record<string, DocKind> = {
  PAN: "pan",
  AADHAAR: "aadhaar",
  PHOTO: "photo",
  SALARY_SLIP: "salary",
  AGREEMENT: "agreement",
  BANK_PASSBOOK: "bank",
  BANK_STATEMENT: "bank",
  OTHER: "other",
};

const DOC_KIND_LABEL: Record<DocKind, string> = {
  pending: "Pending",
  pan: "PAN",
  aadhaar: "Aadhaar",
  photo: "Photo",
  salary: "Salary slip",
  agreement: "Agreement",
  bank: "Bank",
  other: "Other",
};

const DOC_KIND_OPTIONS: DocKind[] = ["pan", "aadhaar", "photo", "salary", "agreement", "bank", "other"];

function num(v: string | number | null | undefined, fallback = 0) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pathsFromDocs(items: DocItem[]): Record<string, string> {
  const pathMap: Record<string, string> = {};
  for (const item of items) {
    if (!item.filePath || item.kind === "pending" || item.kind === "other") continue;
    if (!pathMap[item.kind]) pathMap[item.kind] = item.filePath;
  }
  return pathMap;
}

export function EmployeeForm({
  onCreated,
  editing,
  onCancelEdit,
}: {
  onCreated?: () => void;
  editing?: EmployeeEditSeed | null;
  onCancelEdit?: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(editing?.id);
  const [mode, setMode] = useState<Mode>(isEdit ? "manual" : "documents");
  const [form, setForm] = useState<EmployeeFormData>(editing ? seedToForm(editing) : EMPTY);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractStage, setExtractStage] = useState<"idle" | "uploading" | "classifying">("idle");
  const [detected, setDetected] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [paths, setPaths] = useState<Record<string, string>>(() => {
    if (!editing) return {};
    return {
      ...(editing.photoPath ? { photo: editing.photoPath } : {}),
      ...(editing.panDocPath ? { pan: editing.panDocPath } : {}),
      ...(editing.aadhaarDocPath ? { aadhaar: editing.aadhaarDocPath } : {}),
      ...(editing.agreementPath ? { agreement: editing.agreementPath } : {}),
      ...(editing.bankDocPath ? { bank: editing.bankDocPath } : {}),
      ...(editing.salarySlipPath ? { salary: editing.salarySlipPath } : {}),
    };
  });
  const [rawExtract, setRawExtract] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [savedName, setSavedName] = useState("");
  const [confirmModify, setConfirmModify] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setForm(seedToForm(editing));
      setMode("manual");
      setPaths({
        ...(editing.photoPath ? { photo: editing.photoPath } : {}),
        ...(editing.panDocPath ? { pan: editing.panDocPath } : {}),
        ...(editing.aadhaarDocPath ? { aadhaar: editing.aadhaarDocPath } : {}),
        ...(editing.agreementPath ? { agreement: editing.agreementPath } : {}),
        ...(editing.bankDocPath ? { bank: editing.bankDocPath } : {}),
        ...(editing.salarySlipPath ? { salary: editing.salarySlipPath } : {}),
      });
      return;
    }
    nextEmployeeCode()
      .then((code) => setForm((f) => (f.employeeCode ? f : { ...f, employeeCode: code })))
      .catch(() => {});
  }, [editing]);

  function setField<K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).filter((f) =>
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(f.type),
    );
    if (!incoming.length) {
      setError("Upload JPG, PNG, WebP, or PDF only.");
      return;
    }
    setError("");
    setDocs((prev) => [
      ...prev,
      ...incoming.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        kind: "pending" as const,
        status: "queued" as const,
      })),
    ]);
  }, []);

  async function uploadAll(items: DocItem[]): Promise<DocItem[]> {
    const out: DocItem[] = [];

    for (const item of items) {
      if (item.filePath && item.status === "ready") {
        out.push(item);
        continue;
      }
      setDocs((prev) => prev.map((d) => (d.id === item.id ? { ...d, status: "uploading" } : d)));
      const fd = new FormData();
      fd.append("file", item.file);
      fd.append("kind", item.kind === "pending" ? "misc" : item.kind);
      const res = await fetch("/api/employees/upload", { method: "POST", body: fd });
      const data = (await res.json()) as { filePath?: string; error?: string };
      if (!data.filePath) {
        const failed = { ...item, status: "error" as const, error: data.error || "Upload failed" };
        setDocs((prev) => prev.map((d) => (d.id === item.id ? failed : d)));
        out.push(failed);
        continue;
      }
      const ready = { ...item, status: "ready" as const, filePath: data.filePath };
      setDocs((prev) => prev.map((d) => (d.id === item.id ? ready : d)));
      out.push(ready);
    }
    return out;
  }

  function setDocKind(id: string, kind: DocKind) {
    setDocs((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, kind } : d));
      setPaths(pathsFromDocs(next));
      return next;
    });
  }

  async function extractFromDocs() {
    if (docs.length === 0) {
      setError("Drop all KYC documents together — PAN, Aadhaar, photo, salary slip, agreement, bank proof…");
      return;
    }
    setError("");
    setExtracting(true);
    setExtractStage("uploading");
    try {
      const uploaded = await uploadAll(docs);
      const ok = uploaded.filter((d) => d.status === "ready");
      if (ok.length === 0) {
        setError("All uploads failed.");
        return;
      }

      setExtractStage("classifying");
      const fd = new FormData();
      for (const d of ok) fd.append("files", d.file);
      const res = await fetch("/api/employees/extract", { method: "POST", body: fd });
      const data = (await res.json()) as {
        ok?: boolean;
        data?: Record<string, unknown>;
        error?: string;
      };
      if (!data.ok || !data.data) {
        setError(data.error || "AI extraction failed — fill the form manually.");
        setMode("manual");
        return;
      }

      const d = data.data;
      setRawExtract(JSON.stringify(d));

      const classifications = Array.isArray(d.classifications)
        ? (d.classifications as { fileIndex: number; kind: string; confidence?: number; reason?: string }[])
        : [];

      const classified = ok.map((item, index) => {
        const c = classifications.find((x) => x.fileIndex === index);
        const kind = c ? AI_KIND_TO_DOC[c.kind] || "other" : "other";
        return {
          ...item,
          kind,
          classifyConfidence: c?.confidence,
          classifyReason: c?.reason,
        };
      });
      setDocs(classified);
      setPaths(pathsFromDocs(classified));

      const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "") || "";
      const n = (k: string) => (typeof d[k] === "number" ? String(d[k]) : str(k));

      setForm((f) => ({
        ...f,
        name: str("name") || f.name,
        designation: str("designation") || f.designation,
        department: str("department") || f.department,
        email: str("email") || str("emailPersonal") || f.email,
        phone: str("phone") || f.phone,
        pan: str("pan").toUpperCase() || f.pan,
        aadhaar: str("aadhaar") ? formatAadhaar(str("aadhaar")) : f.aadhaar,
        uan: str("uan") || f.uan,
        addressLine1: str("addressLine1") || f.addressLine1,
        city: str("city") || f.city,
        state: str("state") || f.state,
        pincode: str("pincode") || f.pincode,
        bankAccount: str("bankAccount") || f.bankAccount,
        bankIfsc: str("bankIfsc").toUpperCase() || f.bankIfsc,
        bankName: str("bankName") || f.bankName,
        bankBranch: str("bankBranch") || f.bankBranch,
        basic: n("basic") || f.basic,
        hra: n("hra") || f.hra,
        special: n("special") || f.special,
        otherAllow: n("otherAllow") || f.otherAllow,
        pf: n("pf") || f.pf,
        professionalTax: n("professionalTax") || f.professionalTax,
        tdsPercent: n("tdsPercent") || n("tds") || f.tdsPercent,
        otherDeduct: n("otherDeduct") || f.otherDeduct,
        joinDate: str("joinDate") || f.joinDate,
        notes: [str("notes"), f.notes].filter(Boolean).join(" · "),
      }));
      setDetected(
        Array.isArray(d.documentsDetected)
          ? (d.documentsDetected as string[])
          : classifications.map((c) => c.kind),
      );
      setConfidence(typeof d.confidence === "number" ? d.confidence : null);
      setMode("manual");
    } catch {
      setError("Extraction failed — check connection and try again.");
    } finally {
      setExtracting(false);
      setExtractStage("idle");
    }
  }

  function buildPayload() {
    return {
      id: editing?.id,
      name: form.name,
      employeeCode: form.employeeCode || undefined,
      designation: form.designation || undefined,
      department: form.department || undefined,
      email: form.email || undefined,
      emailOfficial: form.emailOfficial || undefined,
      phone: form.phone,
      pan: form.pan || undefined,
      aadhaar: form.aadhaar || undefined,
      uan: form.uan || undefined,
      addressLine1: form.addressLine1 || undefined,
      city: form.city || undefined,
      state: form.state || undefined,
      pincode: form.pincode || undefined,
      bankAccount: form.bankAccount || undefined,
      bankIfsc: form.bankIfsc || undefined,
      bankName: form.bankName || undefined,
      bankBranch: form.bankBranch || undefined,
      basic: num(form.basic),
      hra: num(form.hra),
      special: num(form.special),
      otherAllow: num(form.otherAllow),
      pf: num(form.pf),
      professionalTax: num(form.professionalTax),
      tdsPercent: num(form.tdsPercent),
      otherDeduct: num(form.otherDeduct),
      joinDate: form.joinDate || undefined,
      photoPath: paths.photo,
      panDocPath: paths.pan,
      aadhaarDocPath: paths.aadhaar,
      agreementPath: paths.agreement,
      bankDocPath: paths.bank,
      salarySlipPath: paths.salary,
      notes: form.notes || undefined,
      rawExtract: rawExtract || undefined,
    };
  }

  function validate(): string | null {
    if (!form.name.trim()) return "Employee name is required.";
    if (!form.phone.trim()) return "Contact number is required.";
    if (form.basic.trim() === "" || Number.isNaN(Number(form.basic))) return "Basic salary is required.";
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (isEdit) {
      setConfirmModify(true);
      return;
    }
    save();
  }

  function save() {
    setConfirmModify(false);
    setError("");
    start(async () => {
      try {
        const payload = buildPayload();
        const emp = isEdit
          ? await upsertEmployee(payload)
          : await createEmployee(payload);
        setSavedName(`${emp.name} (${emp.employeeCode})`);
        if (!isEdit) {
          const nextCode = await nextEmployeeCode().catch(() => "");
          setForm({ ...EMPTY, employeeCode: nextCode });
          setDocs([]);
          setDetected([]);
          setConfidence(null);
          setPaths({});
          setRawExtract("");
        }
        onCreated?.();
        onCancelEdit?.();
        router.refresh();
        setTimeout(() => setSavedName(""), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save employee");
      }
    });
  }

  const { gross, tdsAmount, totalDeduct, netPay } = employeeSalaryTotals({
    basic: num(form.basic),
    hra: num(form.hra),
    special: num(form.special),
    otherAllow: num(form.otherAllow),
    pf: num(form.pf),
    professionalTax: num(form.professionalTax),
    tdsPercent: num(form.tdsPercent),
    otherDeduct: num(form.otherDeduct),
  });

  return (
    <div className="space-y-5">
      {isEdit && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium" style={{ color: "#a5b4fc" }}>
            Editing {editing?.name}
          </p>
          {onCancelEdit && (
            <button type="button" className="btn btn-ghost text-xs py-1" onClick={onCancelEdit}>
              Cancel edit
            </button>
          )}
        </div>
      )}

      {!isEdit && (
      <div
        className="flex gap-2 p-1 rounded-xl w-fit"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {(
          [
            { id: "documents", label: "From documents" },
            { id: "manual", label: "Manual entry" },
          ] as const
        ).map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all"
            style={{
              background: mode === m.id ? "rgba(99,102,241,0.18)" : "transparent",
              color: mode === m.id ? "#a5b4fc" : "rgba(255,255,255,0.45)",
              border: mode === m.id ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      )}

      {mode === "documents" && !isEdit && (
        <div className="space-y-4">
          <div
            onDrop={(e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="rounded-xl cursor-pointer flex flex-col items-center justify-center gap-2"
            style={{
              border: "2px dashed rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.02)",
              padding: "2rem 1.5rem",
            }}
          >
            <p className="text-sm font-medium">Drop all employee documents together</p>
            <p className="text-xs text-center max-w-md" style={{ color: "rgba(255,255,255,0.4)" }}>
              PAN, Aadhaar, photo, salary slip, agreement, passbook / bank statement — AI classifies each file, then extracts the profile
            </p>
            <span className="text-xs px-3 py-1.5 rounded-lg mt-1" style={{ background: "var(--accent)", color: "#fff" }}>
              Browse files
            </span>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {docs.length > 0 && (
            <ul className="space-y-1.5">
              {docs.map((d) => (
                <li
                  key={d.id}
                  className="rounded-lg px-3 py-2.5 text-xs"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium min-w-0 flex-1">{d.file.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span style={{ color: d.status === "error" ? "#f87171" : "rgba(255,255,255,0.35)" }}>
                        {d.status === "uploading"
                          ? "Uploading…"
                          : d.status === "error"
                            ? d.error
                            : `${(d.file.size / 1024).toFixed(0)} KB`}
                      </span>
                      <button
                        type="button"
                        style={{ color: "#f87171" }}
                        onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <label className="text-[0.55rem] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
                      Type
                    </label>
                    <select
                      className="input text-[0.7rem] py-1 px-2 w-auto min-w-[8.5rem]"
                      value={d.kind}
                      onChange={(e) => setDocKind(d.id, e.target.value as DocKind)}
                      disabled={extracting}
                    >
                      {d.kind === "pending" && <option value="pending">Pending AI…</option>}
                      {DOC_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {DOC_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    {d.kind !== "pending" && d.classifyConfidence != null && (
                      <span style={{ color: "rgba(255,255,255,0.4)" }}>
                        {Math.round(d.classifyConfidence * 100)}%
                        {d.classifyReason ? ` · ${d.classifyReason}` : ""}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={extracting || docs.length === 0}
            onClick={extractFromDocs}
          >
            {extracting
              ? extractStage === "uploading"
                ? "Uploading…"
                : "Classifying & extracting…"
              : `Classify & extract (${docs.length})`}
          </button>
        </div>
      )}

      {(mode === "manual" || form.name) && (
        <form onSubmit={submit} className="space-y-5">
          {docs.some((d) => d.kind !== "pending") && (
            <div
              className="rounded-lg p-3 space-y-2"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-[0.6rem] uppercase tracking-widest font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>
                Classified documents — correct if needed
              </p>
              <ul className="space-y-1.5">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="truncate flex-1 min-w-[8rem]" style={{ color: "rgba(255,255,255,0.75)" }}>
                      {d.file.name}
                    </span>
                    <select
                      className="input text-[0.7rem] py-1 px-2 w-auto min-w-[8rem]"
                      value={d.kind === "pending" ? "other" : d.kind}
                      onChange={(e) => setDocKind(d.id, e.target.value as DocKind)}
                    >
                      {DOC_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {DOC_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(detected.length > 0 || confidence != null) && (
            <div
              className="flex flex-wrap items-center gap-2 text-[0.65rem] px-3 py-2 rounded-lg"
              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}
            >
              {detected.map((t) => (
                <span
                  key={t}
                  className="px-1.5 py-0.5 rounded font-bold"
                  style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}
                >
                  {t}
                </span>
              ))}
              {confidence != null && (
                <span style={{ color: "rgba(255,255,255,0.45)" }}>
                  Confidence {Math.round(confidence * 100)}% — verify before saving
                </span>
              )}
            </div>
          )}

          <div>
            <p className="label mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Identity & contact</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Employee code</label>
                <input className="input font-mono" value={form.employeeCode} onChange={(e) => setField("employeeCode", e.target.value)} />
              </div>
              <div>
                <label className="label">Full name *</label>
                <input className="input" required value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </div>
              <div>
                <label className="label">Position / designation</label>
                <input className="input" value={form.designation} onChange={(e) => setField("designation", e.target.value)} />
              </div>
              <div>
                <label className="label">Department</label>
                <input className="input" value={form.department} onChange={(e) => setField("department", e.target.value)} />
              </div>
              <div>
                <label className="label">Personal email</label>
                <input className="input" type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} placeholder="From documents / personal" />
              </div>
              <div>
                <label className="label">Official email</label>
                <input className="input" type="email" value={form.emailOfficial} onChange={(e) => setField("emailOfficial", e.target.value)} placeholder="Enter manually" />
              </div>
              <div>
                <label className="label">Contact number *</label>
                <input className="input" required value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
              </div>
              <div>
                <label className="label">PAN</label>
                <input className="input font-mono" maxLength={10} value={form.pan} onChange={(e) => setField("pan", e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="label">Aadhaar</label>
                <input
                  className="input font-mono"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="XXXX-XXXX-XXXX"
                  maxLength={14}
                  value={form.aadhaar}
                  onChange={(e) => setField("aadhaar", formatAadhaar(e.target.value))}
                />
              </div>
              <div>
                <label className="label">UAN</label>
                <input className="input font-mono" value={form.uan} onChange={(e) => setField("uan", e.target.value)} />
              </div>
              <div>
                <label className="label">Join date</label>
                <input className="input" type="date" value={form.joinDate} onChange={(e) => setField("joinDate", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Address</label>
                <input className="input" value={form.addressLine1} onChange={(e) => setField("addressLine1", e.target.value)} />
              </div>
              <div>
                <label className="label">City</label>
                <input className="input" value={form.city} onChange={(e) => setField("city", e.target.value)} />
              </div>
              <div>
                <label className="label">State</label>
                <input className="input" value={form.state} onChange={(e) => setField("state", e.target.value)} />
              </div>
              <div>
                <label className="label">PIN</label>
                <input className="input" value={form.pincode} onChange={(e) => setField("pincode", e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <p className="label mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Bank details</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Account number</label>
                <input className="input font-mono" value={form.bankAccount} onChange={(e) => setField("bankAccount", e.target.value)} />
              </div>
              <div>
                <label className="label">IFSC</label>
                <input className="input font-mono" value={form.bankIfsc} onChange={(e) => setField("bankIfsc", e.target.value.toUpperCase())} />
              </div>
              <div>
                <label className="label">Bank name</label>
                <input className="input" value={form.bankName} onChange={(e) => setField("bankName", e.target.value)} />
              </div>
              <div>
                <label className="label">Branch</label>
                <input className="input" value={form.bankBranch} onChange={(e) => setField("bankBranch", e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="label" style={{ color: "rgba(255,255,255,0.45)" }}>Salary breakup</p>
              <p className="text-xs tabular-nums" style={{ color: "rgba(255,255,255,0.5)" }}>
                Gross ₹{gross.toLocaleString("en-IN")} · TDS ₹{tdsAmount.toLocaleString("en-IN")} · Deduct ₹{totalDeduct.toLocaleString("en-IN")} ·{" "}
                <span style={{ color: "#34d399" }}>Net ₹{netPay.toLocaleString("en-IN")}</span>
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {(
                [
                  ["basic", "Basic *"],
                  ["hra", "HRA"],
                  ["special", "Special"],
                  ["otherAllow", "Other allow."],
                  ["pf", "PF"],
                  ["professionalTax", "Prof. tax"],
                  ["otherDeduct", "Other deduct."],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    required={key === "basic"}
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                  />
                </div>
              ))}
              <div className="sm:col-span-2 lg:col-span-4">
                <label className="label">TDS %</label>
                <div className="flex flex-wrap gap-2 items-center">
                  {TDS_PRESETS.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setField("tdsPercent", String(pct))}
                      className="text-[0.7rem] font-bold px-3 py-1.5 rounded-lg"
                      style={{
                        background: num(form.tdsPercent) === pct ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.04)",
                        color: num(form.tdsPercent) === pct ? "#a78bfa" : "rgba(255,255,255,0.45)",
                        border: `1px solid ${num(form.tdsPercent) === pct ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.08)"}`,
                      }}
                    >
                      {pct}%
                    </button>
                  ))}
                  <input
                    className="input w-24"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={form.tdsPercent}
                    onChange={(e) => setField("tdsPercent", e.target.value)}
                    title="Custom TDS %"
                  />
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                    of gross → ₹{tdsAmount.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <input className="input" value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Remarks…" />
          </div>

          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Save employee"}
          </button>
        </form>
      )}

      <ConfirmModifyDialog
        open={confirmModify}
        title="Save employee changes?"
        description={`Update ${form.name}${form.employeeCode ? ` (${form.employeeCode})` : ""} in the employee database.`}
        onConfirm={save}
        onCancel={() => setConfirmModify(false)}
        pending={pending}
      />

      {error && (
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
      {savedName && (
        <p className="text-sm" style={{ color: "#34d399" }}>
          ✓ Saved {savedName}
        </p>
      )}
    </div>
  );
}
