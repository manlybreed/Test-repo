"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  addDirectorToPlant,
  clearRequirementFile,
  createPlantTask,
  deletePlantTask,
  exportChecklistCsv,
  getPlantChecklist,
  getPlantDetail,
  listPlantFileComments,
  listPlantFiles,
  listPlantTasks,
  rescanAndMatchPlant,
  setRequirementApplicability,
  updatePlantProfile,
  updatePlantTask,
  updateRequirementNotes,
  uploadRequirementFile,
  upsertPlantFileComment,
  type PlantTaskInput,
} from "@/actions/plant-registry";
import { resolvePlantProfile } from "@/lib/projects/plant-profile";
import {
  formatFeePercent,
  formatSanctionInput,
  parseFeePercentInput,
  parseSanctionInput,
  type FinanceStage,
} from "@/lib/projects/finance-pipeline";
import {
  PlantFinancePipeline,
  type PlantFinanceState,
} from "@/components/plant-finance-pipeline";

type ChecklistRow = Awaited<ReturnType<typeof getPlantChecklist>>[number];
type FileRow = Awaited<ReturnType<typeof listPlantFiles>>["files"][number];
type PlantTaskRow = Awaited<ReturnType<typeof listPlantTasks>>[number];
type PeekMode = "side" | "full";

const GROUP_STYLE: Record<string, { bg: string; fg: string; accent: string }> = {
  SPV: { bg: "#0f766e", fg: "#ecfdf5", accent: "#2dd4bf" },
  DIRECTORS: { bg: "#475569", fg: "#f8fafc", accent: "#94a3b8" },
  PLANT: { bg: "#92400e", fg: "#fffbeb", accent: "#fbbf24" },
  LAND: { bg: "#b45309", fg: "#fffbeb", accent: "#f59e0b" },
  DPR: { bg: "#4338ca", fg: "#eef2ff", accent: "#a5b4fc" },
  EPC: { bg: "#9d174d", fg: "#fdf2f8", accent: "#f9a8d4" },
  THIRD_PARTY: { bg: "#0e7490", fg: "#ecfeff", accent: "#67e8f9" },
  MISC: { bg: "#525252", fg: "#fafafa", accent: "#a3a3a3" },
};

const URGENCY_STYLE: Record<string, { bg: string; fg: string }> = {
  LOW: { bg: "rgba(148,163,184,0.25)", fg: "#cbd5e1" },
  MEDIUM: { bg: "rgba(59,130,246,0.25)", fg: "#93c5fd" },
  HIGH: { bg: "rgba(245,158,11,0.28)", fg: "#fcd34d" },
  CRITICAL: { bg: "rgba(239,68,68,0.28)", fg: "#fca5a5" },
};

const COL = {
  status: "2.75rem",
  doc: "minmax(10rem, 1.35fr)",
  comment: "minmax(8rem, 1fr)",
  time: "minmax(7rem, 0.55fr)",
  actions: "minmax(13.5rem, 1.15fr)",
} as const;

const COL_FULL = {
  status: "2.75rem",
  doc: "minmax(12rem, 1.4fr)",
  comment: "minmax(10rem, 1.1fr)",
  time: "minmax(8rem, 0.5fr)",
  actions: "minmax(18rem, 1.35fr)",
} as const;

const FILE_COLS =
  "1.5rem minmax(0,1.35fr) 4.5rem minmax(8rem,1fr) minmax(7rem,0.7fr)";
const FILE_COLS_FULL =
  "1.5rem minmax(0,1.5fr) 5rem minmax(10rem,1.1fr) minmax(10rem,0.85fr)";

function groupKey(r: ChecklistRow): string {
  return r.catalog.scope === "PARTY" && r.partyName
    ? `DIRECTORS · ${r.partyName}`
    : r.catalog.docGroup;
}

function groupStyle(key: string) {
  return GROUP_STYLE[key.split(" · ")[0]] || GROUP_STYLE.MISC;
}

function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 140ms ease",
      }}
    >
      <path
        d="M6 3.5L10.5 8L6 12.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCollapsePeek() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M4 4.5H7.5M4 4.5V8M4 4.5L8 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14 13.5H10.5M14 13.5V10M14 13.5L10 9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11 4.5H14V7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M7 13.5H4V10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconOpenFull() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M10.5 3.5H14.5V7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 14.5H3.5V10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.5 3.5L10 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3.5 14.5L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCloseSide() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <path
        d="M6.5 4L11.5 9L6.5 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 4L8.5 9L3.5 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CategoryCheckbox({
  paths,
  selected,
  onToggle,
}: {
  paths: string[];
  selected: Set<string>;
  onToggle: (paths: string[], select: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const selectedCount = paths.filter((p) => selected.has(p)).length;
  const all = paths.length > 0 && selectedCount === paths.length;
  const some = selectedCount > 0 && !all;

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some;
  }, [some]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={all}
      disabled={paths.length === 0}
      onChange={() => onToggle(paths, !all)}
      onClick={(e) => e.stopPropagation()}
      aria-label={all ? "Deselect category files" : "Select all files in category"}
      title={all ? "Deselect all in category" : "Select all in category"}
    />
  );
}

export function PlantRegistryPanel({
  plantId,
  plantName,
  mode = "side",
  onModeChange,
  onClose,
  canSeeFees = false,
}: {
  plantId: string;
  plantName: string;
  mode?: PeekMode;
  onModeChange?: (mode: PeekMode) => void;
  onClose?: () => void;
  canSeeFees?: boolean;
}) {
  const [tab, setTab] = useState<"files" | "checklist" | "tasks">("checklist");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [foldersMissing, setFoldersMissing] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<PlantTaskRow[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [directorName, setDirectorName] = useState("");
  const [pending, start] = useTransition();
  const [busyReqIds, setBusyReqIds] = useState<Set<string>>(new Set());
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [zipping, setZipping] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);
  const commentTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const noteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskUrgency, setTaskUrgency] =
    useState<NonNullable<PlantTaskInput["urgency"]>>("MEDIUM");
  const [taskReminder, setTaskReminder] = useState("");
  const [taskTone, setTaskTone] =
    useState<NonNullable<PlantTaskInput["reminderTone"]>>("NORMAL");
  const [profile, setProfile] = useState({
    capacityMw: "",
    tehsil: "",
    district: "",
    dprName: "",
    epcName: "",
    tariff: "",
    bankName: "",
    activeStatus: "ACTIVE" as "ACTIVE" | "INACTIVE",
    feePercent: "",
    sanctionAmount: "",
  });
  const [finance, setFinance] = useState<PlantFinanceState | null>(null);

  const reload = useCallback(() => {
    start(async () => {
      try {
        setError("");
        const [f, c, commentsRows, taskRows, detail] = await Promise.all([
          listPlantFiles(plantId),
          getPlantChecklist(plantId),
          listPlantFileComments(plantId),
          listPlantTasks(plantId),
          getPlantDetail(plantId),
        ]);
        setFiles(f.files);
        setFoldersMissing(f.foldersMissing);
        setChecklist(c);
        setTasks(taskRows);
        if (detail) {
          const p = resolvePlantProfile(detail);
          setProfile({
            capacityMw: p.capacityMw || "",
            tehsil: p.tehsil || "",
            district: p.district || "",
            dprName: p.dprName || "",
            epcName: p.epcName || "",
            tariff: p.tariff || "",
            bankName: p.bankName || "",
            activeStatus: p.activeStatus,
            feePercent: formatFeePercent(detail.feePercent),
            sanctionAmount: formatSanctionInput(detail.sanctionAmount),
          });
          setFinance({
            financeStage: (detail.financeStage || "DOCUMENTATION") as FinanceStage,
            financeProgress: detail.financeProgress ?? 17,
            interestRate: detail.interestRate ?? null,
            docsCompleteAt: detail.docsCompleteAt ?? null,
            mailSentAt: detail.mailSentAt ?? null,
            fieldVisitAt: detail.fieldVisitAt ?? null,
            cmaAt: detail.cmaAt ?? null,
            sanctionAt: detail.sanctionAt ?? null,
            disbursementAt: detail.disbursementAt ?? null,
            sanctionLetterPath: detail.sanctionLetterPath ?? null,
          });
        }
        const map: Record<string, string> = {};
        for (const row of commentsRows) map[row.relativePath] = row.comment;
        setComments(map);
        setSelectedFiles((prev) => {
          const next = new Set<string>();
          for (const path of prev) {
            if (f.files.some((x) => x.relativePath === path)) next.add(path);
          }
          return next;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    });
  }, [plantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (previewPath) setPreviewPath(null);
        else if (mode === "full") onModeChange?.("side");
        else onClose?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onModeChange, mode, previewPath]);

  useEffect(() => {
    const timers = commentTimers.current;
    const noteT = noteTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
      for (const t of Object.values(noteT)) clearTimeout(t);
    };
  }, []);

  const groupedFiles = useMemo(() => {
    const map = new Map<string, FileRow[]>();
    for (const f of files) {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    }
    return [...map.entries()];
  }, [files]);

  const groupedChecklist = useMemo(() => {
    const map = new Map<string, ChecklistRow[]>();
    for (const r of checklist) {
      const key = groupKey(r);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [checklist]);

  const progress = useMemo(() => {
    const required = checklist.filter((r) => {
      if (r.applicability === "NA" || r.applicability === "OPTIONAL") return false;
      if (r.applicability === "REQUIRED") return true;
      return r.catalog.required;
    });
    const got = required.filter((r) => r.received).length;
    return { got, total: required.length };
  }, [checklist]);

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status !== "DONE"),
    [tasks],
  );

  function fileUrl(rel: string, download = false) {
    const q = new URLSearchParams({ path: rel });
    if (download) q.set("download", "1");
    return `/api/projects/${plantId}/file?${q.toString()}`;
  }

  function toggleCollapse(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleFileSelect(rel: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }

  function toggleCategorySelect(paths: string[], select: boolean) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      for (const p of paths) {
        if (select) next.add(p);
        else next.delete(p);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    if (selectedFiles.size === files.length && files.length > 0) {
      setSelectedFiles(new Set());
      return;
    }
    setSelectedFiles(new Set(files.map((f) => f.relativePath)));
  }

  function scheduleFileComment(rel: string, value: string) {
    setComments((prev) => ({ ...prev, [rel]: value }));
    const existing = commentTimers.current[rel];
    if (existing) clearTimeout(existing);
    commentTimers.current[rel] = setTimeout(() => {
      start(async () => {
        try {
          await upsertPlantFileComment(plantId, rel, value);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save comment");
        }
      });
    }, 500);
  }

  function scheduleRequirementNote(id: string, value: string) {
    setChecklist((prev) =>
      prev.map((r) => (r.id === id ? { ...r, notes: value || null } : r)),
    );
    const existing = noteTimers.current[id];
    if (existing) clearTimeout(existing);
    noteTimers.current[id] = setTimeout(() => {
      start(async () => {
        try {
          await updateRequirementNotes(id, value);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to save note");
        }
      });
    }, 500);
  }

  async function downloadZip(paths: string[]) {
    if (paths.length === 0) return;
    setZipping(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${plantId}/zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${plantName.replace(/\s+/g, "_")}_files.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg(`Downloaded ${paths.length} file${paths.length === 1 ? "" : "s"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setZipping(false);
    }
  }

  function markBusy(id: string, on: boolean) {
    setBusyReqIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setApplicabilityFast(
    rowId: string,
    applicability: "REQUIRED" | "OPTIONAL" | "NA",
  ) {
    setChecklist((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, applicability } : r)),
    );
    void setRequirementApplicability(rowId, applicability).catch((err) => {
      setError(err instanceof Error ? err.message : "Update failed");
      reload();
    });
  }

  function uploadToSlot(requirementId: string, file: File) {
    const fd = new FormData();
    fd.append("requirementId", requirementId);
    fd.append("file", file);
    markBusy(requirementId, true);
    void (async () => {
      try {
        await uploadRequirementFile(fd);
        setMsg("File saved");
        reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        markBusy(requirementId, false);
      }
    })();
  }

  function removeFile(row: ChecklistRow, deleteFromDisk: boolean) {
    const label = deleteFromDisk
      ? "Remove link and delete file from disk?"
      : "Unlink file from this checklist slot?";
    if (!window.confirm(label)) return;
    markBusy(row.id, true);
    void (async () => {
      try {
        await clearRequirementFile(row.id, { deleteFromDisk });
        setMsg(deleteFromDisk ? "File removed" : "File unlinked");
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Remove failed");
      } finally {
        markBusy(row.id, false);
      }
    })();
  }

  function submitTask() {
    if (!taskTitle.trim()) return;
    start(async () => {
      try {
        await createPlantTask(plantId, {
          title: taskTitle,
          description: taskDesc,
          urgency: taskUrgency,
          reminderTone: taskTone,
          reminderAt: taskReminder || null,
        });
        setTaskTitle("");
        setTaskDesc("");
        setTaskReminder("");
        setTaskUrgency("MEDIUM");
        setTaskTone("NORMAL");
        setMsg("Task added");
        reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add task");
      }
    });
  }

  const cols = mode === "full" ? COL_FULL : COL;
  const gridCols = `${cols.status} ${cols.doc} ${cols.comment} ${cols.time} ${cols.actions}`;
  const fileCols = mode === "full" ? FILE_COLS_FULL : FILE_COLS;
  const contentMax = mode === "full" ? "max-w-6xl mx-auto w-full" : "w-full";
  const chromeBtn = {
    border: "1px solid rgba(255,255,255,0.14)",
    color: "#d4daf0",
    background: "rgba(255,255,255,0.04)",
  } as const;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="shrink-0 px-3 py-2 flex items-center gap-1"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
      >
        {onClose && (
          <button
            type="button"
            title="Close"
            aria-label="Close panel"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md"
            style={chromeBtn}
            onClick={onClose}
          >
            <IconCloseSide />
          </button>
        )}
        {onModeChange && (
          <button
            type="button"
            title={mode === "full" ? "Exit full page" : "Open as full page"}
            aria-label={mode === "full" ? "Exit full page" : "Open as full page"}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md"
            style={chromeBtn}
            onClick={() => onModeChange(mode === "full" ? "side" : "full")}
          >
            {mode === "full" ? <IconCollapsePeek /> : <IconOpenFull />}
          </button>
        )}
        <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
          {mode === "full" ? "Full page" : "Side peek"}
        </span>
      </div>

      <header
        className={`shrink-0 px-5 py-4 flex flex-wrap items-start justify-between gap-3 ${contentMax}`}
      >
        <div className="min-w-0">
          <p
            className="text-[0.7rem] uppercase tracking-[0.14em] font-semibold mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            Checklist status
          </p>
          <h2 className="text-2xl font-semibold truncate" style={{ color: "var(--text)" }}>
            {plantName}
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {progress.got}/{progress.total} required docs · {openTasks.length} open task
            {openTasks.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {(["checklist", "files", "tasks"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium capitalize"
              style={{
                background: tab === t ? "rgba(99,102,241,0.28)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${tab === t ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.12)"}`,
                color: tab === t ? "#e0e7ff" : "#d4daf0",
              }}
            >
              {t}
              {t === "tasks" && openTasks.length > 0 ? ` (${openTasks.length})` : ""}
            </button>
          ))}
          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded-lg"
            style={chromeBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  const r = await rescanAndMatchPlant(plantId);
                  setMsg(`Matched ${r.matched}/${r.total} · ${r.documents} files`);
                  reload();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Rescan failed");
                }
              })
            }
          >
            Rescan
          </button>
          <button
            type="button"
            className="text-xs px-2.5 py-1.5 rounded-lg"
            style={chromeBtn}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const csv = await exportChecklistCsv(plantId);
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${plantName.replace(/\s+/g, "_")}_checklist.csv`;
                a.click();
              })
            }
          >
            CSV
          </button>
        </div>
      </header>

      <div
        className={`shrink-0 px-5 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2 ${contentMax}`}
      >
        {(
          [
            ["capacityMw", "Capacity (MW)"],
            ["tehsil", "Tehsil"],
            ["district", "District"],
            ["tariff", "Tariff"],
            ["dprName", "DPR"],
            ["epcName", "EPC"],
            ["bankName", "Bank"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block min-w-0">
            <span className="label">{label}</span>
            <input
              className="input text-xs py-1.5"
              value={profile[key]}
              placeholder="—"
              onChange={(e) =>
                setProfile((p) => ({ ...p, [key]: e.target.value }))
              }
              onBlur={() => {
                void updatePlantProfile(plantId, {
                  [key]: profile[key] || null,
                }).catch((err) =>
                  setError(err instanceof Error ? err.message : "Save failed"),
                );
              }}
            />
          </label>
        ))}
        <label className="block min-w-0">
          <span className="label">Status</span>
          <select
            className="input text-xs py-1.5"
            value={profile.activeStatus}
            onChange={(e) => {
              const activeStatus = e.target.value as "ACTIVE" | "INACTIVE";
              setProfile((p) => ({ ...p, activeStatus }));
              void updatePlantProfile(plantId, { activeStatus }).catch((err) =>
                setError(err instanceof Error ? err.message : "Save failed"),
              );
            }}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        {canSeeFees && (
          <>
            <label className="block min-w-0">
              <span className="label">Fee %</span>
              <input
                className="input text-xs py-1.5"
                value={profile.feePercent}
                placeholder="e.g. 1%"
                onChange={(e) =>
                  setProfile((p) => ({ ...p, feePercent: e.target.value }))
                }
                onBlur={() => {
                  const feePercent = parseFeePercentInput(profile.feePercent);
                  if (feePercent !== null && Number.isNaN(feePercent)) return;
                  setProfile((p) => ({
                    ...p,
                    feePercent: formatFeePercent(feePercent),
                  }));
                  void updatePlantProfile(plantId, { feePercent }).catch((err) =>
                    setError(err instanceof Error ? err.message : "Save failed"),
                  );
                }}
              />
            </label>
            <label className="block min-w-0">
              <span className="label">Sanction (₹)</span>
              <input
                className="input text-xs py-1.5"
                value={profile.sanctionAmount}
                placeholder="e.g. 5,60,00,000"
                onChange={(e) =>
                  setProfile((p) => ({ ...p, sanctionAmount: e.target.value }))
                }
                onBlur={() => {
                  const sanctionAmount = parseSanctionInput(profile.sanctionAmount);
                  if (sanctionAmount !== null && Number.isNaN(sanctionAmount)) return;
                  setProfile((p) => ({
                    ...p,
                    sanctionAmount: formatSanctionInput(sanctionAmount),
                  }));
                  void updatePlantProfile(plantId, { sanctionAmount }).catch(
                    (err) =>
                      setError(err instanceof Error ? err.message : "Save failed"),
                  );
                }}
              />
            </label>
          </>
        )}
      </div>

      <div className={`flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0 ${contentMax}`}>
        {finance && (
          <PlantFinancePipeline
            plantId={plantId}
            initial={finance}
            onSaved={reload}
          />
        )}
        {error && (
          <p
            className="text-xs px-3 py-2 rounded-lg"
            style={{ color: "#fecaca", background: "rgba(239,68,68,0.12)" }}
          >
            {error}
          </p>
        )}
        {msg && (
          <p
            className="text-xs px-3 py-2 rounded-lg"
            style={{ color: "#6ee7b7", background: "rgba(16,185,129,0.12)" }}
          >
            {msg}
          </p>
        )}

        {tab === "tasks" && (
          <div className="space-y-4">
            <div
              className="rounded-xl p-4 space-y-3"
              style={{
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Add project task
              </p>
              <input
                className="input"
                placeholder="Task title"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
              />
              <textarea
                className="input min-h-[72px]"
                placeholder="Notes / description (optional)"
                value={taskDesc}
                onChange={(e) => setTaskDesc(e.target.value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">Urgency</label>
                  <select
                    className="input"
                    value={taskUrgency}
                    onChange={(e) =>
                      setTaskUrgency(e.target.value as NonNullable<PlantTaskInput["urgency"]>)
                    }
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="label">Reminder</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={taskReminder}
                    onChange={(e) => setTaskReminder(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Reminder tone</label>
                  <select
                    className="input"
                    value={taskTone}
                    onChange={(e) =>
                      setTaskTone(
                        e.target.value as NonNullable<PlantTaskInput["reminderTone"]>,
                      )
                    }
                  >
                    <option value="GENTLE">Gentle</option>
                    <option value="NORMAL">Normal</option>
                    <option value="URGENT">Urgent</option>
                  </select>
                </div>
              </div>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                style={{
                  background: "rgba(99,102,241,0.25)",
                  border: "1px solid rgba(99,102,241,0.5)",
                  color: "#e0e7ff",
                }}
                disabled={pending || !taskTitle.trim()}
                onClick={submitTask}
              >
                Add task
              </button>
            </div>

            <div className="space-y-2">
              {tasks.map((t) => {
                const urg = URGENCY_STYLE[t.urgency || "MEDIUM"] || URGENCY_STYLE.MEDIUM;
                return (
                  <div
                    key={t.id}
                    className="rounded-lg px-3 py-3 space-y-2"
                    style={{
                      border: "1px solid rgba(255,255,255,0.1)",
                      background:
                        t.status === "DONE"
                          ? "rgba(255,255,255,0.02)"
                          : "rgba(255,255,255,0.04)",
                      opacity: t.status === "DONE" ? 0.7 : 1,
                    }}
                  >
                    <div className="flex flex-wrap items-start gap-2 justify-between">
                      <div className="min-w-0 flex-1">
                        <p
                          className="font-medium"
                          style={{
                            color: "var(--text)",
                            textDecoration:
                              t.status === "DONE" ? "line-through" : undefined,
                          }}
                        >
                          {t.title}
                        </p>
                        {t.description && (
                          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                            {t.description}
                          </p>
                        )}
                      </div>
                      <span
                        className="text-[0.65rem] uppercase tracking-wider font-bold px-2 py-0.5 rounded"
                        style={{ background: urg.bg, color: urg.fg }}
                      >
                        {t.urgency}
                      </span>
                    </div>
                    <div
                      className="flex flex-wrap gap-3 text-xs items-center"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <span>
                        Reminder:{" "}
                        {t.reminderAt
                          ? new Date(t.reminderAt).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "None"}
                      </span>
                      <span>Tone: {t.reminderTone}</span>
                      <span>Status: {t.status.replace("_", " ")}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select
                        className="text-xs rounded-md px-2 py-1"
                        style={{
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "var(--text)",
                        }}
                        value={t.status}
                        disabled={pending}
                        onChange={(e) =>
                          start(async () => {
                            await updatePlantTask(t.id, {
                              status: e.target.value as PlantTaskInput["status"],
                            });
                            reload();
                          })
                        }
                      >
                        <option value="TODO">To do</option>
                        <option value="IN_PROGRESS">In progress</option>
                        <option value="DONE">Done</option>
                      </select>
                      <select
                        className="text-xs rounded-md px-2 py-1"
                        style={{
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "var(--text)",
                        }}
                        value={t.urgency || "MEDIUM"}
                        disabled={pending}
                        onChange={(e) =>
                          start(async () => {
                            await updatePlantTask(t.id, {
                              urgency: e.target
                                .value as NonNullable<PlantTaskInput["urgency"]>,
                            });
                            reload();
                          })
                        }
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                      <select
                        className="text-xs rounded-md px-2 py-1"
                        style={{
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "var(--text)",
                        }}
                        value={t.reminderTone || "NORMAL"}
                        disabled={pending}
                        onChange={(e) =>
                          start(async () => {
                            await updatePlantTask(t.id, {
                              reminderTone: e.target
                                .value as NonNullable<PlantTaskInput["reminderTone"]>,
                            });
                            reload();
                          })
                        }
                      >
                        <option value="GENTLE">Gentle</option>
                        <option value="NORMAL">Normal</option>
                        <option value="URGENT">Urgent</option>
                      </select>
                      <input
                        type="datetime-local"
                        className="text-xs rounded-md px-2 py-1"
                        style={{
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "var(--text)",
                        }}
                        value={toDatetimeLocal(t.reminderAt)}
                        disabled={pending}
                        onChange={(e) =>
                          start(async () => {
                            await updatePlantTask(t.id, {
                              reminderAt: e.target.value || null,
                            });
                            reload();
                          })
                        }
                      />
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded-md"
                        style={{ color: "#fca5a5" }}
                        disabled={pending}
                        onClick={() => {
                          if (!window.confirm("Delete this task?")) return;
                          start(async () => {
                            await deletePlantTask(t.id);
                            reload();
                          });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
              {tasks.length === 0 && (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  No tasks yet for this project.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === "files" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                  style={{
                    background: "rgba(99,102,241,0.22)",
                    border: "1px solid rgba(99,102,241,0.45)",
                    color: "#e0e7ff",
                  }}
                  disabled={zipping || files.length === 0}
                  onClick={() => void downloadZip(files.map((f) => f.relativePath))}
                >
                  {zipping ? "Preparing…" : "Download all"}
                </button>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
                  style={chromeBtn}
                  disabled={zipping || selectedFiles.size === 0}
                  onClick={() => void downloadZip([...selectedFiles])}
                >
                  Download selected ({selectedFiles.size})
                </button>
              </div>
              <button
                type="button"
                className="text-xs"
                style={{ color: "var(--text-muted)" }}
                onClick={toggleSelectAllVisible}
                disabled={files.length === 0}
              >
                {selectedFiles.size === files.length && files.length > 0
                  ? "Clear selection"
                  : "Select all"}
              </button>
            </div>

            {foldersMissing.length > 0 && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Missing folders: {foldersMissing.join(", ")}
              </p>
            )}

            {groupedFiles.map(([cat, list]) => {
              const closed = collapsed[`file:${cat}`] === true;
              const paths = list.map((f) => f.relativePath);
              return (
                <div
                  key={cat}
                  className="rounded-lg overflow-hidden"
                  style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                >
                  <div
                    className="flex items-center gap-2.5 px-3 py-2.5"
                    style={{ background: "rgba(255,255,255,0.04)", color: "#e8ecf6" }}
                  >
                    <CategoryCheckbox
                      paths={paths}
                      selected={selectedFiles}
                      onToggle={toggleCategorySelect}
                    />
                    <button
                      type="button"
                      className="flex-1 flex items-center gap-2.5 text-left min-w-0"
                      onClick={() => toggleCollapse(`file:${cat}`)}
                      aria-expanded={!closed}
                    >
                      <IconChevron open={!closed} />
                      <span className="text-[0.75rem] uppercase tracking-wider font-semibold">
                        {cat}
                      </span>
                      <span
                        className="text-xs tabular-nums px-1.5 py-0.5 rounded"
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          color: "var(--text-muted)",
                        }}
                      >
                        {list.length}
                      </span>
                    </button>
                  </div>
                  {!closed && (
                    <>
                      <div
                        className="grid gap-3 px-3 py-2 text-[0.65rem] uppercase tracking-wider font-semibold"
                        style={{
                          gridTemplateColumns: fileCols,
                          color: "var(--text-muted)",
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(0,0,0,0.15)",
                        }}
                      >
                        <span />
                        <span>File</span>
                        <span className="text-right">Size</span>
                        <span>Comment</span>
                        <span className="text-right">Actions</span>
                      </div>
                      <ul>
                        {list.map((f) => (
                          <li
                            key={f.relativePath}
                            className="kusum-row-hover grid items-start gap-3 px-3 py-2.5 text-sm"
                            style={{
                              gridTemplateColumns: fileCols,
                              borderTop: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={selectedFiles.has(f.relativePath)}
                              onChange={() => toggleFileSelect(f.relativePath)}
                              aria-label={`Select ${f.relativePath}`}
                            />
                            <button
                              type="button"
                              className="text-left break-all rounded-md px-1 -mx-1 transition-colors hover:bg-white/5"
                              style={{ color: "var(--text)" }}
                              onClick={() => setPreviewPath(f.relativePath)}
                              title={f.relativePath}
                            >
                              {f.relativePath}
                            </button>
                            <span
                              className="text-[0.7rem] tabular-nums text-right mt-1"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {(f.size / 1024).toFixed(0)} KB
                            </span>
                            <textarea
                              className="text-xs rounded-md px-2 py-1.5 min-h-[40px] resize-y w-full"
                              style={{
                                background: "rgba(0,0,0,0.25)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                color: "var(--text)",
                              }}
                              placeholder="Add comment…"
                              value={comments[f.relativePath] || ""}
                              onChange={(e) =>
                                scheduleFileComment(f.relativePath, e.target.value)
                              }
                            />
                            <div className="kusum-act-bar">
                              <div className="kusum-act-row">
                                <button
                                  type="button"
                                  className="kusum-act"
                                  onClick={() => setPreviewPath(f.relativePath)}
                                >
                                  View
                                </button>
                                <a
                                  className="kusum-act kusum-act-primary"
                                  href={fileUrl(f.relativePath, true)}
                                >
                                  Download
                                </a>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })}

            {files.length === 0 && (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No files found in plant folder.
              </p>
            )}
          </div>
        )}

        {tab === "checklist" && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="label">Add director</label>
                <input
                  className="input"
                  value={directorName}
                  onChange={(e) => setDirectorName(e.target.value)}
                  placeholder="Full name"
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                disabled={pending || !directorName.trim()}
                onClick={() =>
                  start(async () => {
                    try {
                      await addDirectorToPlant(plantId, directorName);
                      setDirectorName("");
                      reload();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed");
                    }
                  })
                }
              >
                Add
              </button>
            </div>

            <input
              ref={replaceInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                const id = replaceTargetId;
                e.target.value = "";
                setReplaceTargetId(null);
                if (!file || !id) return;
                uploadToSlot(id, file);
              }}
            />

            {groupedChecklist.map(([group, rows]) => {
              const style = groupStyle(group);
              const closed = collapsed[group] === true;
              const got = rows.filter((r) => r.received).length;
              return (
                <div
                  key={group}
                  className="rounded-lg overflow-hidden"
                  style={{ border: `1px solid ${style.accent}44` }}
                >
                  <button
                    type="button"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                    style={{ background: `${style.bg}33` }}
                    onClick={() => toggleCollapse(group)}
                    aria-expanded={!closed}
                  >
                    <span style={{ color: style.accent }}>
                      <IconChevron open={!closed} />
                    </span>
                    <span
                      className="text-[0.72rem] uppercase tracking-wider font-bold px-2.5 py-1 rounded-md"
                      style={{ background: style.bg, color: style.fg }}
                    >
                      {group}
                    </span>
                    <span
                      className="text-xs ml-auto tabular-nums font-medium px-2 py-0.5 rounded"
                      style={{ background: "rgba(0,0,0,0.25)", color: style.accent }}
                    >
                      {got}/{rows.length}
                    </span>
                  </button>

                  {!closed && (
                    <>
                      <div
                        className="grid gap-3 px-3 py-2 text-[0.7rem] uppercase tracking-wider font-semibold"
                        style={{
                          gridTemplateColumns: gridCols,
                          color: "var(--text-muted)",
                          borderTop: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(0,0,0,0.15)",
                        }}
                      >
                        <span title="On file">✓</span>
                        <span>Doc</span>
                        <span>Comment</span>
                        <span>Time recorded</span>
                        <span className="text-right">Actions</span>
                      </div>
                      {rows.map((r) => (
                        <div
                          key={r.id}
                          className="kusum-row-hover grid gap-3 px-3 py-2.5 items-start text-sm"
                          style={{
                            gridTemplateColumns: gridCols,
                            borderTop: "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <div className="pt-0.5">
                            <span
                              className="inline-flex h-5 w-5 items-center justify-center rounded text-[0.7rem]"
                              style={{
                                background: r.received
                                  ? "rgba(16,185,129,0.25)"
                                  : "rgba(255,255,255,0.05)",
                                border: `1px solid ${
                                  r.received
                                    ? "rgba(52,211,153,0.55)"
                                    : "rgba(255,255,255,0.18)"
                                }`,
                                color: r.received ? "#6ee7b7" : "var(--text-muted)",
                              }}
                              title={r.received ? "File on record" : "Missing"}
                              aria-label={r.received ? "Received" : "Missing"}
                            >
                              {r.received ? "✓" : ""}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p
                                className="font-medium leading-snug"
                                style={{
                                  color: "var(--text)",
                                  opacity: r.applicability === "NA" ? 0.55 : 1,
                                  textDecoration:
                                    r.applicability === "NA" ? "line-through" : undefined,
                                }}
                              >
                                {r.catalog.label}
                              </p>
                              {r.applicability === "NA" && (
                                <span
                                  className="text-[0.6rem] uppercase font-bold px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "rgba(148,163,184,0.25)",
                                    color: "#cbd5e1",
                                  }}
                                >
                                  N/A
                                </span>
                              )}
                              {r.applicability === "OPTIONAL" && (
                                <span
                                  className="text-[0.6rem] uppercase font-bold px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "rgba(56,189,248,0.2)",
                                    color: "#7dd3fc",
                                  }}
                                >
                                  Optional
                                </span>
                              )}
                            </div>
                            {r.catalog.description && (
                              <p
                                className="text-[0.7rem] mt-0.5 leading-snug"
                                style={{ color: "var(--text-muted)" }}
                              >
                                {r.catalog.description}
                              </p>
                            )}
                            {r.fileRelativePath && (
                              <button
                                type="button"
                                className="text-[0.7rem] mt-1 truncate max-w-full text-left rounded px-1 -mx-1 transition-colors hover:bg-white/5"
                                style={{ color: "#c7d2fe" }}
                                onClick={() => setPreviewPath(r.fileRelativePath)}
                                title={r.fileRelativePath}
                              >
                                {r.fileRelativePath}
                              </button>
                            )}
                          </div>
                          <textarea
                            className="text-xs rounded-md px-2 py-1.5 min-h-[40px] resize-y w-full"
                            style={{
                              background: "rgba(0,0,0,0.25)",
                              border: "1px solid rgba(255,255,255,0.12)",
                              color: "var(--text)",
                            }}
                            placeholder="Add comment…"
                            value={r.notes || ""}
                            onChange={(e) => scheduleRequirementNote(r.id, e.target.value)}
                          />
                          <div
                            className="text-xs pt-0.5 tabular-nums"
                            style={{ color: "var(--text-muted)" }}
                          >
                            {r.receivedAt
                              ? new Date(r.receivedAt).toLocaleString(undefined, {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                              : "—"}
                          </div>
                          <div className="kusum-act-bar">
                            <select
                              className="kusum-act-select"
                              value={r.applicability || "REQUIRED"}
                              title="Required for this plant?"
                              onChange={(e) => {
                                setApplicabilityFast(
                                  r.id,
                                  e.target.value as "REQUIRED" | "OPTIONAL" | "NA",
                                );
                              }}
                            >
                              <option value="REQUIRED">Required</option>
                              <option value="OPTIONAL">Optional</option>
                              <option value="NA">Not required</option>
                            </select>
                            <div className="kusum-act-row">
                              {r.fileRelativePath ? (
                                <>
                                  <button
                                    type="button"
                                    className="kusum-act"
                                    onClick={() => setPreviewPath(r.fileRelativePath)}
                                  >
                                    View
                                  </button>
                                  <a
                                    className="kusum-act kusum-act-primary"
                                    href={fileUrl(r.fileRelativePath, true)}
                                  >
                                    Download
                                  </a>
                                  <button
                                    type="button"
                                    className="kusum-act"
                                    disabled={busyReqIds.has(r.id)}
                                    onClick={() => {
                                      setReplaceTargetId(r.id);
                                      replaceInputRef.current?.click();
                                    }}
                                  >
                                    Replace
                                  </button>
                                  <button
                                    type="button"
                                    className="kusum-act kusum-act-danger"
                                    disabled={busyReqIds.has(r.id)}
                                    onClick={() => removeFile(r, true)}
                                  >
                                    Remove
                                  </button>
                                </>
                              ) : (
                                <label
                                  className="kusum-act kusum-act-primary"
                                  style={{
                                    opacity: busyReqIds.has(r.id) ? 0.4 : 1,
                                    pointerEvents: busyReqIds.has(r.id)
                                      ? "none"
                                      : undefined,
                                  }}
                                >
                                  Upload
                                  <input
                                    type="file"
                                    className="hidden"
                                    disabled={busyReqIds.has(r.id)}
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      e.target.value = "";
                                      if (!file) return;
                                      uploadToSlot(r.id, file);
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewPath && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onClick={() => setPreviewPath(null)}
        >
          <div
            className="w-full max-w-4xl h-[80vh] rounded-xl overflow-hidden flex flex-col"
            style={{ background: "#111", border: "1px solid rgba(255,255,255,0.12)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-4 py-2"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                {previewPath}
              </p>
              <button
                type="button"
                className="text-xs"
                style={{ color: "#fca5a5" }}
                onClick={() => setPreviewPath(null)}
              >
                Close
              </button>
            </div>
            <iframe title="preview" src={fileUrl(previewPath)} className="flex-1 w-full bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}
