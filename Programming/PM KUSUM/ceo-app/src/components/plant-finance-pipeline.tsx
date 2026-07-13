"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  updatePlantFinancePipeline,
  uploadSanctionLetter,
} from "@/actions/plant-registry";
import {
  FINANCE_STAGES,
  FINANCE_STAGE_LABELS,
  financeStageProgress,
  type FinanceStage,
} from "@/lib/projects/finance-pipeline";

export type PlantFinanceState = {
  financeStage: FinanceStage;
  financeProgress: number;
  interestRate: number | null;
  docsCompleteAt: string | null;
  mailSentAt: string | null;
  fieldVisitAt: string | null;
  cmaAt: string | null;
  sanctionAt: string | null;
  disbursementAt: string | null;
  sanctionLetterPath: string | null;
};

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const DATE_FIELDS: Array<{
  key: keyof Pick<
    PlantFinanceState,
    | "docsCompleteAt"
    | "mailSentAt"
    | "fieldVisitAt"
    | "cmaAt"
    | "sanctionAt"
    | "disbursementAt"
  >;
  label: string;
}> = [
  { key: "docsCompleteAt", label: "Docs complete" },
  { key: "mailSentAt", label: "Mail sent" },
  { key: "fieldVisitAt", label: "Field visit" },
  { key: "cmaAt", label: "CMA" },
  { key: "sanctionAt", label: "Sanction" },
  { key: "disbursementAt", label: "Disbursement" },
];

export function PlantFinancePipeline({
  plantId,
  initial,
  onSaved,
}: {
  plantId: string;
  initial: PlantFinanceState;
  onSaved?: () => void;
}) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const progress = financeStageProgress(state.financeStage);

  useEffect(() => {
    setState(initial);
  }, [initial]);

  function save(patch: Parameters<typeof updatePlantFinancePipeline>[1]) {
    start(async () => {
      try {
        setError("");
        await updatePlantFinancePipeline(plantId, patch);
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <section
      className="rounded-xl p-4 space-y-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Financing pipeline</h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Documentation → Mail → Field visit → CMA → Sanction → Disbursement
          </p>
        </div>
        <label className="block min-w-[7rem]">
          <span className="label">Interest %</span>
          <input
            className="input text-xs py-1.5"
            type="number"
            step="0.01"
            placeholder="e.g. 9.5"
            value={state.interestRate ?? ""}
            disabled={pending}
            onChange={(e) => {
              const raw = e.target.value.trim();
              setState((s) => ({
                ...s,
                interestRate: raw === "" ? null : Number(raw),
              }));
            }}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const interestRate = raw === "" ? null : Number(raw);
              if (raw !== "" && Number.isNaN(interestRate)) return;
              save({ interestRate });
            }}
          />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium" style={{ color: "#a5b4fc" }}>
            {FINANCE_STAGE_LABELS[state.financeStage]}
          </span>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
            {progress}%
          </span>
        </div>
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: `${Math.max(4, progress)}%`,
              background: "linear-gradient(90deg, #6366f1, #34d399)",
            }}
          />
        </div>
        <div className="flex gap-1 mt-2 flex-wrap">
          {FINANCE_STAGES.map((stage) => {
            const active = state.financeStage === stage;
            const done =
              FINANCE_STAGES.indexOf(stage) <=
              FINANCE_STAGES.indexOf(state.financeStage);
            return (
              <button
                key={stage}
                type="button"
                disabled={pending}
                className="text-[0.65rem] px-2 py-1 rounded-md font-medium"
                style={{
                  background: active
                    ? "rgba(99,102,241,0.35)"
                    : done
                      ? "rgba(52,211,153,0.15)"
                      : "rgba(255,255,255,0.04)",
                  border: `1px solid ${
                    active
                      ? "rgba(129,140,248,0.6)"
                      : done
                        ? "rgba(52,211,153,0.35)"
                        : "var(--border)"
                  }`,
                  color: active ? "#c7d2fe" : done ? "#6ee7b7" : "var(--text-muted)",
                }}
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    financeStage: stage,
                    financeProgress: financeStageProgress(stage),
                  }));
                  save({ financeStage: stage });
                }}
              >
                {FINANCE_STAGE_LABELS[stage]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {DATE_FIELDS.map(({ key, label }) => (
          <label key={key} className="block min-w-0">
            <span className="label">{label}</span>
            <input
              type="date"
              className="input text-xs py-1.5"
              value={toDateInput(state[key])}
              disabled={pending}
              onChange={(e) => {
                const v = e.target.value ? `${e.target.value}T12:00:00.000Z` : null;
                setState((s) => ({ ...s, [key]: v }));
                save({ [key]: v });
              }}
            />
          </label>
        ))}
      </div>

      <div>
        <span className="label">Sanction letter</span>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              start(async () => {
                try {
                  setError("");
                  const fd = new FormData();
                  fd.set("plantId", plantId);
                  fd.set("file", file);
                  const { filePath } = await uploadSanctionLetter(fd);
                  setState((s) => ({
                    ...s,
                    sanctionLetterPath: filePath,
                    financeStage: "SANCTION",
                    financeProgress: financeStageProgress("SANCTION"),
                    sanctionAt: new Date().toISOString(),
                  }));
                  onSaved?.();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed");
                } finally {
                  if (fileRef.current) fileRef.current.value = "";
                }
              });
            }}
          />
          <button
            type="button"
            className="btn-ghost text-xs py-1.5 px-3"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
          >
            {state.sanctionLetterPath ? "Replace letter" : "Upload letter"}
          </button>
          {state.sanctionLetterPath && (
            <a
              className="text-xs underline"
              style={{ color: "#a5b4fc" }}
              href={`/api/files/${state.sanctionLetterPath.split("/").map(encodeURIComponent).join("/")}`}
              target="_blank"
              rel="noreferrer"
            >
              View uploaded
            </a>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </section>
  );
}

export function FinanceProgressCell({
  stage,
  progress,
}: {
  stage: FinanceStage;
  progress: number;
}) {
  return (
    <div className="min-w-[7.5rem]" onClick={(e) => e.stopPropagation()}>
      <div className="flex justify-between gap-1 mb-1">
        <span className="text-[0.65rem] truncate" style={{ color: "var(--text-muted)" }}>
          {FINANCE_STAGE_LABELS[stage]}
        </span>
        <span className="text-[0.65rem] tabular-nums" style={{ color: "var(--text-dim)" }}>
          {progress}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.08)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(4, progress)}%`,
            background: "linear-gradient(90deg, #6366f1, #34d399)",
          }}
        />
      </div>
    </div>
  );
}
