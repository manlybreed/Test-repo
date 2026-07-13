"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPlantFromFolderPicker, deleteKusumPlant } from "@/actions/projects";
import {
  createPlantInRoot,
  importPlantFromPath,
  pickAndSavePlantsRoot,
  updatePlantProfile,
} from "@/actions/plant-registry";
import { ConfirmDeleteDialog } from "@/components/confirm-dialogs";
import { PlantRegistryPanel } from "@/components/plant-registry-panel";
import { ChecklistTemplateEditor } from "@/components/checklist-template-editor";
import { formatINR } from "@/lib/utils";
import {
  formatFeePercent,
  formatSanctionInput,
  parseFeePercentInput,
  parseSanctionInput,
  type FinanceStage,
} from "@/lib/projects/finance-pipeline";
import { FinanceProgressCell } from "@/components/plant-finance-pipeline";

type PlantItem = {
  id: string;
  name: string;
  plantShort?: string | null;
  folderPath: string;
  status: string;
  documentsFound: number;
  extractSummary: string | null;
  disclosureFilePath: string | null;
  notes: string | null;
  updatedAt: string;
  checklistReceived?: number;
  checklistRequired?: number;
  capacityMw?: string | null;
  tehsil?: string | null;
  district?: string | null;
  dprName?: string | null;
  epcName?: string | null;
  tariff?: string | null;
  bankName?: string | null;
  activeStatus?: "ACTIVE" | "INACTIVE";
  feePercent?: number | null;
  sanctionAmount?: number | null;
  feeAmount?: number | null;
  financeStage?: FinanceStage;
  financeProgress?: number;
};

type LandParcel = {
  khasra?: string | null;
  area?: string | null;
  village?: string | null;
  tehsil?: string | null;
  district?: string | null;
  leaseDuration?: string | null;
};

type LandSourceExtract = {
  found?: boolean;
  file?: string | null;
  parcels?: LandParcel[];
  notes?: string | null;
};

type LandKycCheckResult = {
  checkpoint?: string;
  ppa?: LandSourceExtract;
  jamabandi?: LandSourceExtract;
  leaseDeed?: LandSourceExtract;
  leasedParcels?: LandParcel[];
  mismatches?: string[];
  leaseTypos?: string[];
  allMatch?: boolean;
  documentsUsed?: string[];
};

type SpvSection1Fields = {
  applicantType?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  cin?: string | null;
  pan?: string | null;
  gstin?: string | null;
  udyam?: string | null;
  authorizedCapital?: string | null;
  paidUpCapital?: string | null;
  authorizedCapitalProposed?: string | null;
  paidUpCapitalProposed?: string | null;
  expensesIncurred?: string | null;
  registeredAddress?: string | null;
  operationalAddress?: string | null;
  state?: string | null;
  district?: string | null;
  pincode?: string | null;
  contactName?: string | null;
  contactDesignation?: string | null;
  mobilePrimary?: string | null;
  mobileAlternate?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  bankName?: string | null;
  bankBranch?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  bankAccountType?: string | null;
};

type SpvSection1Result = {
  checkpoint?: string;
  section1?: SpvSection1Fields;
  documentsUsed?: string[];
  notes?: string | null;
  confidence?: number | null;
};

type DirectorRow = {
  name?: string | null;
  designation?: string | null;
  dinOrPan?: string | null;
  dateOfBirth?: string | null;
  shareholdingPct?: string | null;
};

type PromoterNwRow = {
  name?: string | null;
  netWorth?: string | null;
  remarks?: string | null;
};

type Section23Fields = {
  directors?: DirectorRow[];
  promotersNetWorth?: PromoterNwRow[];
  combinedNetWorth?: string | null;
  totalLiquidAssets?: string | null;
  liquidityMet?: string | null;
  liquidityShortfall?: string | null;
  liquidityGapPlan?: string | null;
};

type Section23Result = {
  checkpoint?: string;
  section23?: Section23Fields;
  documentsUsed?: string[];
  notes?: string | null;
  confidence?: number | null;
};

type Section4Fields = {
  component?: string | null;
  panelType?: string | null;
  landOwnership?: string | null;
  leaseTenure?: string | null;
  lessorName?: string | null;
  capacityAcMw?: string | null;
  capacityDcMwp?: string | null;
  discom?: string | null;
  tariff?: string | null;
  ppaTenureYears?: string | null;
  moduleTechnology?: string | null;
  inverterType?: string | null;
  mountingType?: string | null;
  p90Generation?: string | null;
  p50Generation?: string | null;
  moduleEfficiencyY1?: string | null;
  annualDegradation?: string | null;
  yield25YearMwh?: string | null;
  pvsystAvailable?: string | null;
  khasra?: string | null;
  village?: string | null;
  tehsil?: string | null;
  district?: string | null;
  state?: string | null;
  gpsPlant?: string | null;
  gpsGss?: string | null;
  distanceGssKm?: string | null;
  dprProjectCost?: string | null;
  loanAmountRequested?: string | null;
  marginMoney?: string | null;
  loaRef?: string | null;
  ppaDate?: string | null;
  rreclRegNo?: string | null;
  expectedCod?: string | null;
  siteCompletionPct?: string | null;
  workDoneBrief?: string | null;
};

type Section4Result = {
  checkpoint?: string;
  section4?: Section4Fields;
  documentsUsed?: string[];
  notes?: string | null;
  confidence?: number | null;
};

type JobKind = "land" | "section1" | "section23" | "section4";

type CheckProgress = {
  plantId: string;
  pct: number;
  step: string;
  kind: JobKind;
};

function statusBadge(status: string) {
  if (status === "LAND_OK") return { label: "LAND OK", cls: "badge-final" };
  if (status === "LAND_REVIEW") return { label: "LAND REVIEW", cls: "badge-draft" };
  if (status === "SECTION1_READY") return { label: "SECTION 1", cls: "badge-final" };
  if (status === "SECTION23_READY") return { label: "SECTION 2–3", cls: "badge-final" };
  if (status === "SECTION4_READY") return { label: "SECTION 4", cls: "badge-final" };
  if (status === "FORM_READY") return { label: "FORM READY", cls: "badge-final" };
  return { label: status, cls: "badge-draft" };
}

const SECTION4_LABELS: Array<[keyof Section4Fields, string]> = [
  ["component", "PM KUSUM Component"],
  ["panelType", "Panel Type"],
  ["landOwnership", "Land Ownership"],
  ["leaseTenure", "Lease Tenure"],
  ["lessorName", "Lessor"],
  ["capacityAcMw", "Capacity AC (MW)"],
  ["capacityDcMwp", "Capacity DC (MWp)"],
  ["discom", "DISCOM / Nodal"],
  ["tariff", "PPA Tariff"],
  ["ppaTenureYears", "PPA Tenure (yrs)"],
  ["moduleTechnology", "Module Technology"],
  ["inverterType", "Inverter Type"],
  ["mountingType", "Mounting Type"],
  ["p90Generation", "P90 Generation"],
  ["p50Generation", "P50 Generation"],
  ["moduleEfficiencyY1", "Module Efficiency Y1"],
  ["annualDegradation", "Annual Degradation"],
  ["yield25YearMwh", "25-Year Yield (MWh)"],
  ["pvsystAvailable", "PVsyst Available?"],
  ["khasra", "Khasra"],
  ["village", "Village"],
  ["tehsil", "Tehsil"],
  ["district", "District"],
  ["state", "State"],
  ["gpsPlant", "GPS Plant"],
  ["gpsGss", "GPS GSS"],
  ["distanceGssKm", "Distance to GSS (km)"],
  ["dprProjectCost", "Total Project Cost (DPR)"],
  ["loanAmountRequested", "Loan Amount"],
  ["marginMoney", "Margin Money (30%)"],
  ["loaRef", "LOA Ref"],
  ["ppaDate", "PPA Date"],
  ["rreclRegNo", "RRECL / SNA Reg"],
  ["expectedCod", "Expected COD"],
  ["siteCompletionPct", "Site Completion %"],
  ["workDoneBrief", "Work done so far"],
];

const SECTION1_LABELS: Array<[keyof SpvSection1Fields, string]> = [
  ["applicantType", "Type of Applicant"],
  ["legalName", "Full Legal Name"],
  ["tradeName", "Brand / Trade Name"],
  ["cin", "CIN"],
  ["pan", "PAN"],
  ["gstin", "GSTIN"],
  ["udyam", "Udyam / MSME"],
  ["authorizedCapital", "Authorized Capital"],
  ["paidUpCapital", "Paid-Up Capital (current)"],
  ["authorizedCapitalProposed", "Authorized Capital (proposed)"],
  ["paidUpCapitalProposed", "Paid-Up Capital (proposed)"],
  ["expensesIncurred", "Expenses incurred in SPV"],
  ["registeredAddress", "Registered Office"],
  ["operationalAddress", "Operational Office"],
  ["state", "State"],
  ["district", "District"],
  ["pincode", "PIN"],
  ["contactName", "Primary Contact"],
  ["contactDesignation", "Designation"],
  ["mobilePrimary", "Mobile (Primary)"],
  ["mobileAlternate", "Mobile (Alternate)"],
  ["email", "Email"],
  ["whatsapp", "WhatsApp"],
  ["bankName", "Bank Name"],
  ["bankBranch", "Branch"],
  ["bankAccount", "Account No."],
  ["bankIfsc", "IFSC"],
  ["bankAccountType", "Account Type"],
];

function ParcelTable({
  title,
  parcels,
  empty,
}: {
  title: string;
  parcels: LandParcel[];
  empty?: string;
}) {
  return (
    <div className="mt-3">
      <p
        className="text-[0.65rem] tracking-[0.12em] uppercase font-semibold mb-2"
        style={{ color: "var(--text-dim)" }}
      >
        {title}
      </p>
      {parcels.length === 0 ? (
        <p style={{ color: "var(--text-dim)" }}>{empty || "None extracted"}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
          <table className="data text-xs">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th>Khasra</th>
                <th>Area</th>
                <th>Village</th>
                <th>Tehsil</th>
                <th>District</th>
                <th>Lease duration</th>
              </tr>
            </thead>
            <tbody>
              {parcels.map((p, i) => (
                <tr key={`${p.khasra}-${i}`}>
                  <td className="font-medium">{p.khasra || "—"}</td>
                  <td>{p.area || "—"}</td>
                  <td>{p.village || "—"}</td>
                  <td>{p.tehsil || "—"}</td>
                  <td>{p.district || "—"}</td>
                  <td>{p.leaseDuration || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Section23Output({
  result,
  filePath,
}: {
  result: Section23Result;
  filePath?: string | null;
}) {
  const s = result.section23 || {};
  const directors = s.directors ?? [];
  const nw = s.promotersNetWorth ?? [];
  return (
    <div
      className="rounded-xl p-4 mb-6 text-xs space-y-3"
      style={{
        background: "rgba(245,158,11,0.08)",
        border: "1px solid rgba(245,158,11,0.3)",
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold text-sm" style={{ color: "#fbbf24" }}>
          Section 2–3 — Directors &amp; Net Worth (Director KYC)
        </p>
        <div className="flex items-center gap-2">
          {typeof result.confidence === "number" && (
            <span style={{ color: "var(--text-dim)" }}>
              confidence {(result.confidence * 100).toFixed(0)}%
            </span>
          )}
          {filePath && (
            <Link
              href={`/api/files/${filePath}`}
              target="_blank"
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: "rgba(16,185,129,0.12)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#34d399",
              }}
            >
              Download DOCX
            </Link>
          )}
        </div>
      </div>
      {(result.documentsUsed?.length ?? 0) > 0 && (
        <p style={{ color: "var(--text-dim)" }}>Used: {result.documentsUsed!.join(" · ")}</p>
      )}
      <p
        className="text-[0.65rem] tracking-[0.12em] uppercase font-semibold"
        style={{ color: "var(--text-dim)" }}
      >
        Section 2 — Directors
      </p>
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="data text-xs">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Sr</th>
              <th>Name</th>
              <th>Designation</th>
              <th>DIN / PAN</th>
              <th>DOB</th>
              <th>Share %</th>
            </tr>
          </thead>
          <tbody>
            {directors.length === 0 ? (
              <tr>
                <td colSpan={6}>—</td>
              </tr>
            ) : (
              directors.map((d, i) => (
                <tr key={`${d.name}-${i}`}>
                  <td>{i + 1}</td>
                  <td className="font-medium">{d.name || "—"}</td>
                  <td>{d.designation || "—"}</td>
                  <td>{d.dinOrPan || "—"}</td>
                  <td>{d.dateOfBirth || "—"}</td>
                  <td>{d.shareholdingPct || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p
        className="text-[0.65rem] tracking-[0.12em] uppercase font-semibold"
        style={{ color: "var(--text-dim)" }}
      >
        Section 3 — Promoter Net Worth
      </p>
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="data text-xs">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Sr</th>
              <th>Promoter</th>
              <th>Net Worth</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {nw.length === 0 ? (
              <tr>
                <td colSpan={4}>—</td>
              </tr>
            ) : (
              nw.map((r, i) => (
                <tr key={`${r.name}-${i}`}>
                  <td>{i + 1}</td>
                  <td className="font-medium">{r.name || "—"}</td>
                  <td>{r.netWorth || "—"}</td>
                  <td>{r.remarks || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-2" style={{ color: "var(--text-muted)" }}>
        <p>Combined NW: {s.combinedNetWorth || "—"}</p>
        <p>Total liquid assets: {s.totalLiquidAssets || "—"}</p>
        <p>Liquidity met: {s.liquidityMet || "—"}</p>
        <p>Gap plan: {s.liquidityGapPlan || "—"}</p>
      </div>
      {result.notes && <p style={{ color: "#fbbf24" }}>Notes: {result.notes}</p>}
    </div>
  );
}

function Section4Output({
  result,
  filePath,
}: {
  result: Section4Result;
  filePath?: string | null;
}) {
  const s = result.section4 || {};
  return (
    <div
      className="rounded-xl p-4 mb-6 text-xs space-y-3"
      style={{
        background: "rgba(56,189,248,0.08)",
        border: "1px solid rgba(56,189,248,0.3)",
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold text-sm" style={{ color: "#7dd3fc" }}>
          Section 4 — Plant / Project (DPR)
        </p>
        <div className="flex items-center gap-2">
          {typeof result.confidence === "number" && (
            <span style={{ color: "var(--text-dim)" }}>
              confidence {(result.confidence * 100).toFixed(0)}%
            </span>
          )}
          {filePath && (
            <Link
              href={`/api/files/${filePath}`}
              target="_blank"
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: "rgba(16,185,129,0.12)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#34d399",
              }}
            >
              Download DOCX
            </Link>
          )}
        </div>
      </div>
      {(result.documentsUsed?.length ?? 0) > 0 && (
        <p style={{ color: "var(--text-dim)" }}>Used: {result.documentsUsed!.join(" · ")}</p>
      )}
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="data text-xs">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {SECTION4_LABELS.map(([key, label]) => (
              <tr key={key}>
                <td className="font-medium whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {label}
                </td>
                <td>{s[key] || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.notes && <p style={{ color: "#fbbf24" }}>Notes: {result.notes}</p>}
    </div>
  );
}

function Section1Output({
  result,
  filePath,
}: {
  result: SpvSection1Result;
  filePath?: string | null;
}) {
  const s = result.section1 || {};
  return (
    <div
      className="rounded-xl p-4 mb-6 text-xs space-y-3"
      style={{
        background: "rgba(99,102,241,0.08)",
        border: "1px solid rgba(99,102,241,0.3)",
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-semibold text-sm" style={{ color: "#a5b4fc" }}>
          Section 1 — Applicant / SPV Details
        </p>
        <div className="flex items-center gap-2">
          {typeof result.confidence === "number" && (
            <span style={{ color: "var(--text-dim)" }}>
              confidence {(result.confidence * 100).toFixed(0)}%
            </span>
          )}
          {filePath && (
            <Link
              href={`/api/files/${filePath}`}
              target="_blank"
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: "rgba(16,185,129,0.12)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#34d399",
              }}
            >
              Download DOCX
            </Link>
          )}
        </div>
      </div>
      {(result.documentsUsed?.length ?? 0) > 0 && (
        <p style={{ color: "var(--text-dim)" }}>Used: {result.documentsUsed!.join(" · ")}</p>
      )}
      <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--border)" }}>
        <table className="data text-xs">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Field</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {SECTION1_LABELS.map(([key, label]) => (
              <tr key={key}>
                <td className="font-medium whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                  {label}
                </td>
                <td>{s[key] || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.notes && <p style={{ color: "#fbbf24" }}>Notes: {result.notes}</p>}
    </div>
  );
}

export function ProjectsClient({
  plants,
  plantsRoot: initialRoot,
  canSeeFees = false,
}: {
  plants: PlantItem[];
  plantsRoot: string | null;
  canSeeFees?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<PlantItem | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const [plantsRoot, setPlantsRoot] = useState(initialRoot);
  const [peekPlantId, setPeekPlantId] = useState<string | null>(null);
  const [peekMode, setPeekMode] = useState<"side" | "full">("side");
  const [peekWidth, setPeekWidth] = useState(960);
  const [showTemplate, setShowTemplate] = useState(false);
  const resizingRef = useRef(false);
  const peekWidthRef = useRef(960);
  const peekPlant = plants.find((p) => p.id === peekPlantId) ?? null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem("kusum-peek-width");
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 480 && n <= 1600) {
          setPeekWidth(n);
          peekWidthRef.current = n;
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!resizingRef.current) return;
      const next = Math.min(
        Math.max(window.innerWidth - e.clientX, 480),
        Math.min(window.innerWidth * 0.95, 1600),
      );
      peekWidthRef.current = next;
      setPeekWidth(next);
    }
    function onUp() {
      if (!resizingRef.current) return;
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem("kusum-peek-width", String(peekWidthRef.current));
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function openPeek(id: string) {
    setPeekPlantId(id);
    setPeekMode("side");
  }

  function closePeek() {
    setPeekPlantId(null);
    setPeekMode("side");
  }
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newShort, setNewShort] = useState("");
  const [importPath, setImportPath] = useState("");
  const [check, setCheck] = useState<CheckProgress | null>(null);
  const [landReport, setLandReport] = useState<{
    plantId: string;
    land: LandKycCheckResult;
  } | null>(null);
  const [section1Report, setSection1Report] = useState<{
    plantId: string;
    section1: SpvSection1Result;
    filePath?: string | null;
  } | null>(null);
  const [section23Report, setSection23Report] = useState<{
    plantId: string;
    section23: Section23Result;
    filePath?: string | null;
  } | null>(null);
  const [section4Report, setSection4Report] = useState<{
    plantId: string;
    section4: Section4Result;
    filePath?: string | null;
  } | null>(null);

  function onAddPlant() {
    setError("");
    setAdding(true);
    start(async () => {
      try {
        const plant = await addPlantFromFolderPicker();
        if (!plant) return;
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add plant");
      } finally {
        setAdding(false);
      }
    });
  }

  function onSetRoot() {
    setError("");
    start(async () => {
      try {
        const root = await pickAndSavePlantsRoot();
        if (!root) return;
        setPlantsRoot(root);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not set plants root");
      }
    });
  }

  function onCreatePlant() {
    setError("");
    start(async () => {
      try {
        await createPlantInRoot({ name: newName, plantShort: newShort || undefined });
        setShowCreate(false);
        setNewName("");
        setNewShort("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create plant");
      }
    });
  }

  function onImportPath() {
    if (!importPath.trim()) return;
    setError("");
    setAdding(true);
    start(async () => {
      try {
        await importPlantFromPath(importPath.trim());
        setImportPath("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      } finally {
        setAdding(false);
      }
    });
  }

  async function streamJob(
    id: string,
    kind: JobKind,
    url: string,
    startStep: string,
  ) {
    setError("");
    if (kind === "land") setLandReport(null);
    if (kind === "section1") setSection1Report(null);
    if (kind === "section23") setSection23Report(null);
    if (kind === "section4") setSection4Report(null);
    setCheck({ plantId: id, pct: 1, step: startStep, kind });

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plantId: id }),
      });
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastResult: Record<string, unknown> | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as {
            pct?: number;
            step?: string;
            error?: string;
            result?: Record<string, unknown>;
          };
          if (msg.error) throw new Error(msg.error);
          if (typeof msg.pct === "number") {
            setCheck({
              plantId: id,
              pct: msg.pct,
              step: msg.step || "Working…",
              kind,
            });
          }
          if (msg.result) lastResult = msg.result;
        }
      }

      if (kind === "land" && lastResult?.land) {
        setLandReport({ plantId: id, land: lastResult.land as LandKycCheckResult });
      }
      if (kind === "section1" && lastResult?.section1) {
        setSection1Report({
          plantId: id,
          section1: lastResult.section1 as SpvSection1Result,
          filePath: (lastResult.filePath as string) || null,
        });
      }
      if (kind === "section23" && lastResult?.section23) {
        setSection23Report({
          plantId: id,
          section23: lastResult.section23 as Section23Result,
          filePath: (lastResult.filePath as string) || null,
        });
      }
      if (kind === "section4" && lastResult?.section4) {
        setSection4Report({
          plantId: id,
          section4: lastResult.section4 as Section4Result,
          filePath: (lastResult.filePath as string) || null,
        });
      }
      router.refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Request failed";
      try {
        const m = raw.match(/\{[\s\S]*"message"\s*:\s*"([^"]+)"/);
        if (m?.[1] && /prompt is too long/i.test(m[1])) {
          setError("Documents too large — retry with fewer / smaller source files.");
        } else if (m?.[1]) {
          setError(m[1]);
        } else {
          setError(raw);
        }
      } catch {
        setError(raw);
      }
    } finally {
      setCheck(null);
    }
  }

  function confirmDelete() {
    if (!deleting) return;
    setError("");
    start(async () => {
      try {
        await deleteKusumPlant(deleting.id);
        setDeleting(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed");
        setDeleting(null);
      }
    });
  }

  const draft = plants.filter((p) => p.status === "DRAFT").length;
  const landDone = plants.filter((p) => p.status === "LAND_OK" || p.status === "LAND_REVIEW").length;
  const checking = !!check;
  const totalFees = canSeeFees
    ? plants.reduce((sum, p) => sum + (p.feeAmount ?? 0), 0)
    : 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div
          className={`grid gap-4 flex-1 min-w-[280px] ${
            canSeeFees ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-3"
          }`}
        >
          {[
            { label: "Plants", value: String(plants.length), color: "#818cf8", bg: "rgba(99,102,241,0.1)" },
            { label: "Draft", value: String(draft), color: "#fbbf24", bg: "rgba(245,158,11,0.1)" },
            { label: "Land checked", value: String(landDone), color: "#34d399", bg: "rgba(16,185,129,0.1)" },
            ...(canSeeFees
              ? [
                  {
                    label: "Total fees",
                    value: formatINR(totalFees),
                    color: "#f472b6",
                    bg: "rgba(244,114,182,0.1)",
                  },
                ]
              : []),
          ].map((s) => (
            <div
              key={s.label}
              className="relative overflow-hidden rounded-xl p-4"
              style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
            >
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)`,
                }}
              />
              <p
                className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
                style={{ color: "var(--text-dim)" }}
              >
                {s.label}
              </p>
              <p className="relative text-3xl font-bold tabular-nums" style={{ color: s.color }}>
                {s.value}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 shrink-0 items-stretch min-w-[200px]">
          <button
            type="button"
            onClick={onSetRoot}
            disabled={pending}
            className="text-xs px-3 py-2 rounded-lg text-left"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--text-muted)",
            }}
            title={plantsRoot || "Not set"}
          >
            {plantsRoot ? `Root: …/${plantsRoot.split("/").slice(-2).join("/")}` : "Set plants root (OneDrive)"}
          </button>
          <button
            type="button"
            onClick={() => setShowTemplate(true)}
            disabled={pending}
            className="text-xs px-3 py-2 rounded-lg text-left"
            style={{
              background: "rgba(45,212,191,0.1)",
              border: "1px solid rgba(45,212,191,0.35)",
              color: "#5eead4",
            }}
          >
            Edit checklist template
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddPlant}
              disabled={pending || adding || checking}
              className="flex-1 text-xs px-3 py-2 rounded-lg font-medium disabled:opacity-40"
              style={{
                background: "rgba(99,102,241,0.18)",
                border: "1px solid rgba(99,102,241,0.4)",
                color: "#a5b4fc",
              }}
            >
              {adding ? "Importing…" : "Import folder"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              disabled={pending || !plantsRoot}
              className="flex-1 text-xs px-3 py-2 rounded-lg font-medium disabled:opacity-40"
              style={{
                background: "rgba(16,185,129,0.12)",
                border: "1px solid rgba(16,185,129,0.3)",
                color: "#34d399",
              }}
            >
              New plant
            </button>
          </div>
        </div>
      </div>

      {showCreate && (
        <div
          className="mb-6 p-4 rounded-xl space-y-3"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
        >
          <p className="text-sm font-medium">Create plant under OneDrive root</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Legal name *</label>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ACME SOLAR SPV PRIVATE LIMITED" />
            </div>
            <div>
              <label className="label">Short name (files)</label>
              <input className="input" value={newShort} onChange={(e) => setNewShort(e.target.value)} placeholder="Acme Solar" />
            </div>
          </div>
          <button type="button" className="btn btn-primary text-xs" disabled={!newName.trim() || pending} onClick={onCreatePlant}>
            Create folder &amp; checklist
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="label">Or paste plant folder path</label>
          <input
            className="input"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="/Users/…/SOLARSEED AGRI TECH PRIVATE LIMITED"
          />
        </div>
        <button type="button" className="btn btn-ghost text-xs" disabled={!importPath.trim() || pending} onClick={onImportPath}>
          Import path
        </button>
      </div>

      {error && (
        <p className="text-xs mb-4" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      {check && (
        <div
          className="rounded-xl p-4 mb-6"
          style={{ background: "var(--bg-panel)", border: "1px solid rgba(99,102,241,0.35)" }}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm font-medium" style={{ color: "#a5b4fc" }}>
              {check.kind === "section1"
                ? "Section 1 — SPV KYC"
                : check.kind === "section23"
                  ? "Sections 2–3 — Director KYC"
                  : check.kind === "section4"
                    ? "Section 4 — DPR"
                    : "Checkpoint 1 — Land KYC"}
            </p>
            <span className="text-xs tabular-nums font-semibold" style={{ color: "#818cf8" }}>
              {Math.round(check.pct)}%
            </span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden mb-2"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{
                width: `${Math.min(100, Math.max(2, check.pct))}%`,
                background: "linear-gradient(90deg, #6366f1, #34d399)",
              }}
            />
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {check.step}
          </p>
        </div>
      )}

      {section1Report?.section1 && (
        <Section1Output result={section1Report.section1} filePath={section1Report.filePath} />
      )}

      {section23Report?.section23 && (
        <Section23Output
          result={section23Report.section23}
          filePath={section23Report.filePath}
        />
      )}

      {section4Report?.section4 && (
        <Section4Output result={section4Report.section4} filePath={section4Report.filePath} />
      )}

      {landReport?.land && (
        <div
          className="rounded-xl p-4 mb-6 text-xs space-y-2"
          style={{
            background: landReport.land.allMatch
              ? "rgba(16,185,129,0.08)"
              : "rgba(245,158,11,0.08)",
            border: `1px solid ${
              landReport.land.allMatch ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.35)"
            }`,
          }}
        >
          <p
            className="font-semibold text-sm"
            style={{ color: landReport.land.allMatch ? "#34d399" : "#fbbf24" }}
          >
            {landReport.land.allMatch
              ? "Land KYC match — PPA (last page), jamabandi & lease deed agree"
              : "Land KYC review needed — mismatches or lease typos"}
          </p>
          {(landReport.land.documentsUsed?.length ?? 0) > 0 && (
            <p style={{ color: "var(--text-dim)" }}>
              Used: {landReport.land.documentsUsed!.join(" · ")}
            </p>
          )}
          <ParcelTable
            title="Leased khasras (consensus)"
            parcels={landReport.land.leasedParcels ?? []}
            empty="No leased khasras extracted"
          />
          <ParcelTable
            title="From PPA (last page / schedule)"
            parcels={landReport.land.ppa?.parcels ?? []}
          />
          <ParcelTable title="From lease deed" parcels={landReport.land.leaseDeed?.parcels ?? []} />
          <ParcelTable title="From jamabandi" parcels={landReport.land.jamabandi?.parcels ?? []} />
          {(landReport.land.mismatches ?? []).map((m) => (
            <p key={m} style={{ color: "#fbbf24" }}>
              • {m}
            </p>
          ))}
          {(landReport.land.leaseTypos ?? []).map((m) => (
            <p key={m} style={{ color: "#f87171" }}>
              • Lease typo: {m}
            </p>
          ))}
        </div>
      )}

      {adding && (
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          Choose a plant folder in the dialog… (download iCloud files locally first)
        </p>
      )}

      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-base font-semibold">Plants</h2>
          <span
            className="text-xs px-2 py-0.5 rounded-md tabular-nums"
            style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.2)",
              color: "#818cf8",
            }}
          >
            {plants.length}
          </span>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="data">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th>Plant</th>
                <th>Capacity</th>
                <th>Tehsil</th>
                <th>District</th>
                <th>DPR</th>
                <th>EPC</th>
                <th>Tariff</th>
                <th>Bank</th>
                <th>Pipeline</th>
                {canSeeFees && (
                  <>
                    <th>Fee %</th>
                    <th>Sanction</th>
                    <th>Fee amt</th>
                  </>
                )}
                <th>Active</th>
                <th>Checklist</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plants.map((p) => {
                const badge = statusBadge(p.status);
                const peekOpen = peekPlantId === p.id;
                const active = (p.activeStatus || "ACTIVE") === "ACTIVE";
                const stage = (p.financeStage || "DOCUMENTATION") as FinanceStage;
                const progress = p.financeProgress ?? 17;
                return (
                  <tr
                    key={p.id}
                    onClick={() => openPeek(p.id)}
                    className="cursor-pointer"
                    style={{
                      background: peekOpen ? "rgba(99,102,241,0.08)" : undefined,
                      outline: peekOpen ? "1px solid rgba(99,102,241,0.45)" : undefined,
                      outlineOffset: "-1px",
                    }}
                  >
                    <td className="font-medium">
                      <div>{p.name}</div>
                      <div
                        className="text-[0.65rem] font-mono truncate max-w-[200px]"
                        style={{ color: "var(--text-muted)" }}
                        title={p.folderPath}
                      >
                        {p.plantShort || p.folderPath.split("/").pop()}
                      </div>
                    </td>
                    <td className="text-sm tabular-nums whitespace-nowrap">
                      {p.capacityMw ? `${p.capacityMw}` : "—"}
                    </td>
                    <td className="text-sm">{p.tehsil || "—"}</td>
                    <td className="text-sm">{p.district || "—"}</td>
                    <td
                      className="text-sm max-w-[120px] truncate"
                      title={p.dprName || undefined}
                    >
                      {p.dprName || "—"}
                    </td>
                    <td
                      className="text-sm max-w-[120px] truncate"
                      title={p.epcName || undefined}
                    >
                      {p.epcName || "—"}
                    </td>
                    <td className="text-sm whitespace-nowrap">{p.tariff || "—"}</td>
                    <td className="text-sm whitespace-nowrap">{p.bankName || "—"}</td>
                    <td>
                      <FinanceProgressCell stage={stage} progress={progress} />
                    </td>
                    {canSeeFees && (
                      <>
                        <td
                          className="text-sm tabular-nums"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            className="input text-xs py-1 w-[4.5rem]"
                            key={`fee-${p.id}-${p.feePercent ?? "x"}`}
                            defaultValue={formatFeePercent(p.feePercent)}
                            placeholder="%"
                            onBlur={(e) => {
                              const feePercent = parseFeePercentInput(e.target.value);
                              if (feePercent !== null && Number.isNaN(feePercent)) return;
                              e.target.value = formatFeePercent(feePercent);
                              start(async () => {
                                await updatePlantProfile(p.id, { feePercent });
                                router.refresh();
                              });
                            }}
                          />
                        </td>
                        <td
                          className="text-sm tabular-nums"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            className="input text-xs py-1 w-[8.5rem]"
                            key={`san-${p.id}-${p.sanctionAmount ?? "x"}`}
                            defaultValue={formatSanctionInput(p.sanctionAmount)}
                            placeholder="₹"
                            onBlur={(e) => {
                              const sanctionAmount = parseSanctionInput(e.target.value);
                              if (
                                sanctionAmount !== null &&
                                Number.isNaN(sanctionAmount)
                              )
                                return;
                              e.target.value = formatSanctionInput(sanctionAmount);
                              start(async () => {
                                await updatePlantProfile(p.id, { sanctionAmount });
                                router.refresh();
                              });
                            }}
                          />
                        </td>
                        <td className="text-sm tabular-nums whitespace-nowrap">
                          {typeof p.feeAmount === "number"
                            ? formatINR(p.feeAmount)
                            : "—"}
                        </td>
                      </>
                    )}
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="text-[0.65rem] uppercase tracking-wider font-bold px-2 py-1 rounded-md"
                        style={{
                          background: active
                            ? "rgba(16,185,129,0.18)"
                            : "rgba(148,163,184,0.18)",
                          border: `1px solid ${
                            active
                              ? "rgba(52,211,153,0.4)"
                              : "rgba(148,163,184,0.35)"
                          }`,
                          color: active ? "#6ee7b7" : "#cbd5e1",
                        }}
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            try {
                              await updatePlantProfile(p.id, {
                                activeStatus: active ? "INACTIVE" : "ACTIVE",
                              });
                              router.refresh();
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : "Update failed",
                              );
                            }
                          })
                        }
                      >
                        {active ? "Active" : "Inactive"}
                      </button>
                    </td>
                    <td className="tabular-nums text-sm">
                      {typeof p.checklistReceived === "number"
                        ? `${p.checklistReceived}/${p.checklistRequired ?? "—"}`
                        : "—"}
                    </td>
                    <td>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2 justify-end flex-wrap">
                        <button
                          type="button"
                          onClick={() => openPeek(p.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                          style={{
                            background: peekOpen
                              ? "rgba(99,102,241,0.25)"
                              : "rgba(99,102,241,0.12)",
                            border: "1px solid rgba(99,102,241,0.35)",
                            color: "#c7d2fe",
                          }}
                        >
                          {peekOpen ? "Open" : "Files & checklist"}
                        </button>
                        <button
                          type="button"
                          disabled={checking || pending}
                          onClick={() =>
                            void streamJob(
                              p.id,
                              "section1",
                              "/api/projects/spv-section1",
                              "Starting Section 1 (SPV KYC)…",
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                          style={{
                            background: "rgba(16,185,129,0.12)",
                            border: "1px solid rgba(16,185,129,0.28)",
                            color: "#34d399",
                          }}
                        >
                          {check?.plantId === p.id && check.kind === "section1"
                            ? "Filling…"
                            : "Fill Section 1"}
                        </button>
                        <button
                          type="button"
                          disabled={checking || pending}
                          onClick={() =>
                            void streamJob(
                              p.id,
                              "section23",
                              "/api/projects/director-section23",
                              "Starting Sections 2–3 (Director KYC)…",
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                          style={{
                            background: "rgba(245,158,11,0.12)",
                            border: "1px solid rgba(245,158,11,0.28)",
                            color: "#fbbf24",
                          }}
                        >
                          {check?.plantId === p.id && check.kind === "section23"
                            ? "Filling…"
                            : "Fill S2–S3"}
                        </button>
                        <button
                          type="button"
                          disabled={checking || pending}
                          onClick={() =>
                            void streamJob(
                              p.id,
                              "section4",
                              "/api/projects/dpr-section4",
                              "Starting Section 4 (DPR)…",
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                          style={{
                            background: "rgba(56,189,248,0.12)",
                            border: "1px solid rgba(56,189,248,0.28)",
                            color: "#7dd3fc",
                          }}
                        >
                          {check?.plantId === p.id && check.kind === "section4"
                            ? "Filling…"
                            : "Fill Section 4"}
                        </button>
                        <button
                          type="button"
                          disabled={checking || pending}
                          onClick={() =>
                            void streamJob(
                              p.id,
                              "land",
                              "/api/projects/land-kyc-check",
                              "Starting Land KYC checkpoint…",
                            )
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                          style={{
                            background: "rgba(99,102,241,0.12)",
                            border: "1px solid rgba(99,102,241,0.28)",
                            color: "#a5b4fc",
                          }}
                        >
                          {check?.plantId === p.id && check.kind === "land"
                            ? "Checking…"
                            : "Check Land KYC"}
                        </button>
                        {p.disclosureFilePath && (
                          <Link
                            href={`/api/files/${p.disclosureFilePath}`}
                            target="_blank"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid var(--border)",
                              color: "var(--text-muted)",
                            }}
                          >
                            DOCX
                          </Link>
                        )}
                        <button
                          type="button"
                          disabled={pending || checking}
                          onClick={() => setDeleting(p)}
                          className="text-[0.65rem] px-2 py-1 rounded-md"
                          style={{ color: "#f87171" }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {plants.length === 0 && (
                <tr>
                  <td colSpan={canSeeFees ? 16 : 13} className="text-center py-12">
                    <p style={{ color: "var(--text-dim)" }} className="mb-3">
                      No plants yet.
                    </p>
                    <button
                      type="button"
                      onClick={onAddPlant}
                      disabled={pending || adding || checking}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
                      style={{
                        background: "rgba(99,102,241,0.18)",
                        border: "1px solid rgba(99,102,241,0.35)",
                        color: "#a5b4fc",
                      }}
                    >
                      <span className="text-lg leading-none">+</span>
                      Add plant folder
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {peekPlant && (
        <>
          {peekMode === "side" && (
            <button
              type="button"
              aria-label="Close checklist"
              className="fixed inset-0 z-40"
              style={{ background: "rgba(0,0,0,0.5)" }}
              onClick={closePeek}
            />
          )}
          <aside
            className={`fixed z-50 flex flex-col shadow-2xl ${
              peekMode === "full" ? "inset-0 w-full h-full" : "top-0 right-0 h-full"
            }`}
            style={{
              width: peekMode === "full" ? "100%" : peekWidth,
              maxWidth: peekMode === "full" ? "100%" : "95vw",
              background: "var(--bg-panel, #181c27)",
              borderLeft:
                peekMode === "side" ? "1px solid rgba(255,255,255,0.12)" : undefined,
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`${peekPlant.name} checklist`}
          >
            {peekMode === "side" && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize panel"
                title="Drag to resize"
                className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 hover:bg-indigo-400/40"
                style={{ touchAction: "none" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  resizingRef.current = true;
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
              />
            )}
            <PlantRegistryPanel
              plantId={peekPlant.id}
              plantName={peekPlant.name}
              mode={peekMode}
              onModeChange={setPeekMode}
              onClose={closePeek}
              canSeeFees={canSeeFees}
            />
          </aside>
        </>
      )}

      {showTemplate && (
        <ChecklistTemplateEditor onClose={() => setShowTemplate(false)} />
      )}

      <ConfirmDeleteDialog
        open={!!deleting}
        title="Delete plant?"
        description={
          deleting
            ? `Remove “${deleting.name}” from Projects. The source folder on disk is not deleted.`
            : ""
        }
        itemLabel={deleting?.name}
        pending={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
