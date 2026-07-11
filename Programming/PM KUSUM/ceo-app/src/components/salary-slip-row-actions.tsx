"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSalarySlip, regenerateSalarySlip } from "@/actions/payroll";
import { ConfirmDeleteDialog, ConfirmModifyDialog } from "@/components/confirm-dialogs";

export function SalarySlipRegenerateButton({
  slipId,
  employeeName,
  periodLabel,
}: {
  slipId: string;
  employeeName: string;
  periodLabel: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  function onRegenerate() {
    start(async () => {
      try {
        await regenerateSalarySlip(slipId);
        setConfirmOpen(false);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Regenerate failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
        style={{
          background: "rgba(99,102,241,0.08)",
          border: "1px solid rgba(99,102,241,0.25)",
          color: "#818cf8",
          cursor: "pointer",
        }}
        title="Regenerate slip from current employee salary"
      >
        Modify
      </button>
      <ConfirmModifyDialog
        open={confirmOpen}
        title="Regenerate salary slip"
        description={`Rebuild the PDF and amounts for ${employeeName} · ${periodLabel} from the employee’s current salary structure. The previous PDF will be replaced.`}
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onRegenerate}
      />
    </>
  );
}

export function SalarySlipDeleteButton({
  slipId,
  employeeName,
  periodLabel,
}: {
  slipId: string;
  employeeName: string;
  periodLabel: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  function onDelete() {
    start(async () => {
      try {
        await deleteSalarySlip(slipId);
        setConfirmOpen(false);
        router.refresh();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
        style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.25)",
          color: "#f87171",
          cursor: "pointer",
        }}
        title="Delete salary slip"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M8 6V4h8v2"/>
        </svg>
        Del
      </button>
      <ConfirmDeleteDialog
        open={confirmOpen}
        title="Delete salary slip"
        itemLabel={`${employeeName} · ${periodLabel}`}
        description="The PDF file will also be removed from storage."
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onDelete}
      />
    </>
  );
}
