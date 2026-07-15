"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  deleteAgreement,
  finalizeAgreement,
  uploadAgreementFile,
} from "@/actions/agreements";
import { ConfirmDeleteDialog } from "@/components/confirm-dialogs";
import { formatINR } from "@/lib/utils";
import type { AgreementEditSeed } from "@/components/agreement-form";

export type AgreementListItem = {
  id: string;
  clientId: string | null;
  clientName: string;
  spvName: string | null;
  tokenFeePerPlant: number;
  plantCount: number;
  successFeePct: number;
  effectiveDate: string | Date;
  status: string;
  filePath: string | null;
  isImported?: boolean;
  notes?: string | null;
  inputsJson?: unknown;
};

function toEditSeed(a: AgreementListItem): AgreementEditSeed {
  const raw =
    a.inputsJson && typeof a.inputsJson === "object"
      ? (a.inputsJson as Record<string, unknown>)
      : {};
  const str = (k: string) =>
    typeof raw[k] === "string" ? (raw[k] as string) : undefined;
  const num = (k: string) =>
    typeof raw[k] === "number" ? (raw[k] as number) : undefined;
  const date =
    typeof a.effectiveDate === "string"
      ? a.effectiveDate
      : a.effectiveDate.toISOString();

  return {
    id: a.id,
    clientId: a.clientId,
    clientName: a.clientName,
    clientAddress: str("clientAddress") ?? undefined,
    clientGstin: str("clientGstin") ?? undefined,
    clientPan: str("clientPan") ?? undefined,
    clientEmail: str("clientEmail"),
    clientMobile: str("clientMobile"),
    spvName: a.spvName,
    plantCount: num("plantCount") ?? a.plantCount,
    tokenFeePerPlant: num("tokenFeePerPlant") ?? a.tokenFeePerPlant,
    successFeePct: num("successFeePct") ?? a.successFeePct,
    gstPct: num("gstPct"),
    designatedLender: str("designatedLender"),
    loanType: str("loanType"),
    interestMin: str("interestMin"),
    interestMax: str("interestMax"),
    minLoan: str("minLoan"),
    maxLoan: str("maxLoan"),
    tenure: str("tenure"),
    moratorium: str("moratorium"),
    repaymentSchedule: str("repaymentSchedule"),
    collateral: str("collateral"),
    plantCapacityAC: str("plantCapacityAC"),
    plantCapacityDC: str("plantCapacityDC"),
    tariff: str("tariff"),
    dprAmount: str("dprAmount"),
    effectiveDate: date,
    status: a.status === "DRAFT" ? "DRAFT" : "FINAL",
  };
}

function fileLabel(path: string | null) {
  if (!path) return "File";
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "doc" || ext === "docx") return "DOCX";
  return "File";
}

function AgreementUploadButton({
  agreementId,
  pending,
  onUploading,
}: {
  agreementId: string;
  pending: boolean;
  onUploading: (run: () => Promise<void>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const busy = pending || localBusy;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setLocalBusy(true);
          onUploading(async () => {
            try {
              const fd = new FormData();
              fd.set("agreementId", agreementId);
              fd.set("file", file);
              await uploadAgreementFile(fd);
            } finally {
              setLocalBusy(false);
              if (inputRef.current) inputRef.current.value = "";
            }
          });
        }}
      />
      <button
        type="button"
        className="text-xs font-medium px-2 py-1 rounded-lg"
        style={{
          background: "rgba(16,185,129,0.1)",
          border: "1px solid rgba(52,211,153,0.3)",
          color: "#6ee7b7",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.65 : 1,
        }}
        disabled={busy}
        title="Upload signed / final agreement (PDF or Word) — marks as imported and infers fees"
        onClick={() => inputRef.current?.click()}
      >
        {localBusy ? "Uploading…" : "Upload"}
      </button>
    </>
  );
}

export function AgreementLibrary({
  agreements,
  totalTokenFees,
  onEdit,
}: {
  agreements: AgreementListItem[];
  totalTokenFees: number;
  onEdit: (seed: AgreementEditSeed) => void;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<AgreementListItem | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  function confirmDelete() {
    if (!deleting) return;
    setError("");
    start(async () => {
      try {
        await deleteAgreement(deleting.id);
        setDeleting(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
        setDeleting(null);
      }
    });
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Library</h2>
          <span
            className="text-xs px-2 py-0.5 rounded-md tabular-nums"
            style={{
              background: "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.2)",
              color: "#818cf8",
            }}
          >
            {agreements.length}
          </span>
        </div>
        {totalTokenFees > 0 && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Token fees collected:{" "}
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              {formatINR(totalTokenFees)}
            </span>
          </span>
        )}
      </div>

      {error && (
        <p className="text-xs mb-3" style={{ color: "#f87171" }}>
          {error}
        </p>
      )}

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--border)" }}
      >
        <table className="data">
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.02)" }}>
              <th>Client</th>
              <th>SPV</th>
              <th>Token Fee</th>
              <th>Success %</th>
              <th>Date</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agreements.map((a) => {
              const date =
                typeof a.effectiveDate === "string"
                  ? new Date(a.effectiveDate)
                  : a.effectiveDate;
              return (
                <tr key={a.id}>
                  <td>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{a.clientName}</span>
                      {a.isImported && (
                        <span
                          className="text-[0.55rem] px-1.5 py-0.5 rounded font-semibold"
                          style={{
                            background: "rgba(99,102,241,0.12)",
                            color: "#818cf8",
                            border: "1px solid rgba(99,102,241,0.2)",
                          }}
                        >
                          IMPORTED
                        </span>
                      )}
                    </div>
                    {a.notes && (
                      <p
                        className="text-xs mt-0.5 max-w-[260px] leading-snug"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        title={a.notes}
                      >
                        {a.notes}
                      </p>
                    )}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    {a.spvName || "—"}
                  </td>
                  <td className="tabular-nums text-sm">
                    {formatINR(a.tokenFeePerPlant * a.plantCount)}
                  </td>
                  <td className="tabular-nums text-sm">
                    <span style={{ color: "#818cf8" }}>{a.successFeePct}%</span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    {date.toLocaleDateString("en-IN")}
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        a.status === "FINAL" ? "badge-final" : "badge-draft"
                      }`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {a.filePath && (
                        <Link
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
                          style={{
                            background: "rgba(99,102,241,0.1)",
                            border: "1px solid rgba(99,102,241,0.2)",
                            color: "#818cf8",
                          }}
                          href={`/api/files/${a.filePath}`}
                          target="_blank"
                        >
                          {fileLabel(a.filePath)}
                        </Link>
                      )}
                      <AgreementUploadButton
                        agreementId={a.id}
                        pending={pending}
                        onUploading={(run) => {
                          setError("");
                          start(async () => {
                            try {
                              await run();
                              router.refresh();
                            } catch (e) {
                              setError(
                                e instanceof Error ? e.message : "Upload failed",
                              );
                            }
                          });
                        }}
                      />
                      <button
                        type="button"
                        className="text-xs font-medium px-2 py-1 rounded-lg"
                        style={{
                          background: "rgba(99,102,241,0.1)",
                          border: "1px solid rgba(129,140,248,0.25)",
                          color: "#c7d2fe",
                        }}
                        disabled={pending}
                        onClick={() => onEdit(toEditSeed(a))}
                      >
                        Edit
                      </button>
                      {a.status === "DRAFT" && (
                        <button
                          type="button"
                          className="text-xs font-medium px-2 py-1 rounded-lg"
                          style={{
                            background: "rgba(16,185,129,0.1)",
                            border: "1px solid rgba(52,211,153,0.3)",
                            color: "#6ee7b7",
                          }}
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              await finalizeAgreement(a.id);
                              router.refresh();
                            })
                          }
                        >
                          Finalize
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-xs font-medium px-2 py-1 rounded-lg"
                        style={{
                          background: "rgba(239,68,68,0.08)",
                          border: "1px solid rgba(239,68,68,0.25)",
                          color: "#f87171",
                        }}
                        disabled={pending}
                        onClick={() => setDeleting(a)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {agreements.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-12">
                  <p style={{ color: "var(--text-dim)" }}>
                    No agreements yet — create your first one above.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDeleteDialog
        open={!!deleting}
        title="Delete agreement"
        itemLabel={
          deleting
            ? `${deleting.clientName}${deleting.spvName ? ` · ${deleting.spvName}` : ""}`
            : undefined
        }
        description="The DOCX file and version history for this agreement will be removed."
        pending={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
