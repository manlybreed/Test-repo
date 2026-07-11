"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSalarySlipPayment } from "@/actions/payroll";
import { GlassSelect } from "@/components/glass-select";

type Status = "PAID" | "UNPAID";

const OPTIONS = [
  { value: "UNPAID", label: "UNPAID", color: "#f87171" },
  { value: "PAID", label: "PAID", color: "#34d399" },
];

const META: Record<Status, { bg: string; border: string; color: string }> = {
  PAID: { bg: "rgba(16,185,129,0.15)", border: "rgba(52,211,153,0.35)", color: "#34d399" },
  UNPAID: { bg: "rgba(248,113,113,0.15)", border: "rgba(248,113,113,0.35)", color: "#f87171" },
};

export function SalarySlipStatusCell({
  slipId,
  initialStatus,
  onStatusChange,
}: {
  slipId: string;
  initialStatus: string | null;
  onStatusChange?: (status: Status) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(
    initialStatus === "PAID" ? "PAID" : "UNPAID",
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const meta = META[status];

  useEffect(() => {
    setStatus(initialStatus === "PAID" ? "PAID" : "UNPAID");
  }, [initialStatus]);

  function onChange(next: string) {
    const st: Status = next === "PAID" ? "PAID" : "UNPAID";
    if (st === status) return;
    const prev = status;
    setStatus(st);
    onStatusChange?.(st);
    setError("");
    start(async () => {
      try {
        await updateSalarySlipPayment({ id: slipId, paymentStatus: st });
        router.refresh();
      } catch (e) {
        setStatus(prev);
        onStatusChange?.(prev);
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-0.5" style={{ minWidth: 88 }}>
      <GlassSelect
        value={status}
        options={OPTIONS}
        onChange={onChange}
        disabled={pending}
        minWidth={112}
        buttonClassName="inline-flex items-center gap-1 text-[0.65rem] px-1.5 py-0.5 rounded font-semibold transition-all self-start"
        buttonStyle={{
          background: meta.bg,
          color: meta.color,
          border: `1px solid ${meta.border}`,
        }}
        renderTrigger={(selected) => (
          <>
            {selected?.label ?? status}
            <svg width="7" height="7" viewBox="0 0 10 10">
              <path
                d="M2 3.5l3 3 3-3"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </>
        )}
      />
      {error && (
        <span className="text-[0.55rem]" style={{ color: "#f87171" }}>
          ⚠ {error}
        </span>
      )}
    </div>
  );
}
