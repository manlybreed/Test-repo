"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteInvoice } from "@/actions/invoices";
import { ConfirmDeleteDialog } from "@/components/confirm-dialogs";

export function InvoiceDeleteButton({
  invoiceId,
  invoiceNumber,
  buyerName,
}: {
  invoiceId: string;
  invoiceNumber: string;
  buyerName: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  function onDelete() {
    start(async () => {
      try {
        await deleteInvoice(invoiceId);
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
        title="Delete invoice"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M8 6V4h8v2"/>
        </svg>
        Del
      </button>
      <ConfirmDeleteDialog
        open={confirmOpen}
        title="Delete invoice"
        itemLabel={`${invoiceNumber} · ${buyerName}`}
        description="Invoice lines and payment status will be removed."
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onDelete}
      />
    </>
  );
}
