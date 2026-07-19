"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  convertProformaToTaxInvoice,
  deleteInvoice,
} from "@/actions/invoices";
import { ConfirmDeleteDialog } from "@/components/confirm-dialogs";
import { InvoiceRefundWizard } from "@/components/invoice-refund-wizard";

export function InvoiceDeleteButton({
  invoiceId,
  invoiceNumber,
  buyerName,
  status,
}: {
  invoiceId: string;
  invoiceNumber: string;
  buyerName: string;
  status?: string | null;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, start] = useTransition();

  if (status && status !== "DRAFT") {
    return null;
  }

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
        title="Delete draft only"
      >
        Del
      </button>
      <ConfirmDeleteDialog
        open={confirmOpen}
        title="Delete draft"
        itemLabel={`${invoiceNumber} · ${buyerName}`}
        description="Only DRAFT documents can be deleted. Issued tax invoices must be adjusted via Credit Note."
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={onDelete}
      />
    </>
  );
}

export function InvoiceConvertProformaButton({
  invoiceId,
  documentType,
}: {
  invoiceId: string;
  documentType?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (documentType !== "PROFORMA") return null;

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
      style={{
        background: "rgba(129,140,248,0.12)",
        border: "1px solid rgba(129,140,248,0.3)",
        color: "#818cf8",
        cursor: "pointer",
      }}
      disabled={pending}
      onClick={() => {
        start(async () => {
          try {
            const res = await convertProformaToTaxInvoice(invoiceId);
            alert(`Tax invoice ${res.number} created from proforma.`);
            router.refresh();
          } catch (e) {
            alert(e instanceof Error ? e.message : "Convert failed");
          }
        });
      }}
    >
      → Tax inv
    </button>
  );
}

export function InvoiceRefundButton({
  invoiceId,
  invoiceNumber,
  grandTotal,
  documentType,
  status,
}: {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  documentType?: string | null;
  status?: string | null;
}) {
  if (documentType !== "TAX_INVOICE" || status !== "ISSUED") return null;
  return (
    <InvoiceRefundWizard
      invoiceId={invoiceId}
      invoiceNumber={invoiceNumber}
      grandTotal={grandTotal}
    />
  );
}
