"use client";

import { useState, useTransition } from "react";
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
}: {
  slipId: string;
  initialStatus: string | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(
    initialStatus === "PAID" ? "PAID" : "UNPAID",
  );
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const meta = META[status];

  function onChange(next: string) {
    const st: Status = next === "PAID" ? "PAID" : "UNPAID";
    if (st === status) return;
    const prev = status;
    setStatus(st);
    setError("");
    start(async () => {
      try {
        await updateSalarySlipPayment({ id: slipId, paymentStatus: st });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        router.refresh();
      } catch (e) {
        setStatus(prev);
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 py-0.5" style={{ minWidth: 108 }}>
      <GlassSelect
        value={status}
        options={OPTIONS}
        onChange={onChange}
        disabled={pending}
        minWidth={128}
        buttonClassName="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-semibold transition-all self-start"
        buttonStyle={{
          background: meta.bg,
          color: meta.color,
          border: `1px solid ${meta.border}`,
        }}
        renderTrigger={(selected) => (
          <>
            {selected?.label ?? status}
            <svg width="8" height="8" viewBox="0 0 10 10">
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
      {saved && (
        <span className="text-[0.6rem]" style={{ color: "#34d399" }}>
          ✓ Saved
        </span>
      )}
      {error && (
        <span className="text-[0.6rem]" style={{ color: "#f87171" }}>
          ⚠ {error}
        </span>
      )}
    </div>
  );
}
