import Link from "next/link";
import { listInvoices } from "@/actions/invoices";
import { listClients } from "@/actions/clients";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "@/components/invoice-form";
import { ImportSection } from "./import-section";
import { InvoiceDatabase } from "@/components/invoice-database";
import { formatINR } from "@/lib/utils";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  const [invoices, clients] = await Promise.all([listInvoices(), listClients()]);

  // Build buyer suggestions from clients + unique past invoice buyers
  const pastBuyers = await prisma.invoice.findMany({
    select: { buyerName: true, buyerGstin: true, buyerAddress: true, buyerState: true, buyerStateCode: true },
    orderBy: { createdAt: "desc" },
  });
  const clientSuggestions = clients.map((c) => ({
    name: c.name,
    gstin: c.gstin ?? "",
    address: [c.addressLine1, c.city, c.state].filter(Boolean).join(", "),
    state: c.state ?? "",
    stateCode: c.stateCode ?? "",
  }));
  const seen = new Set(clients.map((c) => c.name.toLowerCase()));
  const buyerSuggestions = [...clientSuggestions];
  for (const b of pastBuyers) {
    if (!seen.has(b.buyerName.toLowerCase())) {
      seen.add(b.buyerName.toLowerCase());
      buyerSuggestions.push({
        name: b.buyerName,
        gstin: b.buyerGstin ?? "",
        address: b.buyerAddress ?? "",
        state: b.buyerState ?? "",
        stateCode: b.buyerStateCode ?? "",
      });
    }
  }

  const numCount = new Map<string, number>();
  for (const inv of invoices) numCount.set(inv.number, (numCount.get(inv.number) ?? 0) + 1);
  const hasDupes = [...numCount.values()].some((v) => v > 1);

  const totalTaxable = invoices.reduce((s, i) => s + i.taxableTotal, 0);
  const totalGrand = invoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalTax = totalGrand - totalTaxable;

  const dbRows = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    buyerName: inv.buyerName,
    remarks: inv.remarks,
    serviceDesc: inv.serviceDesc ?? null,
    invoiceDate: inv.invoiceDate.toISOString(),
    dueDate: inv.dueDate?.toISOString() ?? null,
    gstEntity: inv.gstEntity ?? null,
    paymentStatus: inv.paymentStatus ?? null,
    tdsDeducted: inv.tdsDeducted,
    tdsPercent: inv.tdsPercent ?? null,
    taxableTotal: inv.taxableTotal,
    grandTotal: inv.grandTotal,
    isImported: inv.isImported,
    filePath: inv.filePath ?? null,
    sourceFilePath: inv.sourceFilePath ?? null,
  }));

  return (
    <div>
      <header className="mb-8">
        <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}>
          Module · GST Invoicing
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">GST Invoices</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          GST-compliant tax invoices with BluRidge letterhead. Import from Zoho, Tally, or any platform.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total billed",   value: formatINR(totalGrand),   color: "#fbbf24", bg: "rgba(240,180,41,0.1)" },
          { label: "Taxable amount", value: formatINR(totalTaxable),  color: "#818cf8", bg: "rgba(99,102,241,0.08)" },
          { label: "Tax collected",  value: formatINR(totalTax),      color: "#34d399", bg: "rgba(16,185,129,0.08)" },
        ].map((s) => (
          <div key={s.label} className="relative overflow-hidden rounded-xl p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)` }} />
            <p className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
              style={{ color: "var(--text-dim)" }}>{s.label}</p>
            <p className="relative text-xl font-bold tabular-nums leading-tight" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {sp.created && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-6 text-sm"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
          <span className="flex items-center gap-2" style={{ color: "#34d399" }}>
            <span>✓</span> Invoice {sp.created} created.
          </span>
          <div className="flex items-center gap-2">
            <Link
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}
              href={`/api/files/invoices/${sp.created}.pdf`}
              target="_blank"
            >
              View
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}
              href={`/api/files/invoices/${sp.created}.pdf`}
              download={`${sp.created}.pdf`}
            >
              Download
            </Link>
          </div>
        </div>
      )}

      {hasDupes && (
        <div className="px-4 py-3 rounded-xl mb-6 text-sm"
          style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
          ⚠ Duplicate invoice numbers detected in the database. Please review the table below.
        </div>
      )}

      <ImportSection />

      <section className="relative overflow-hidden rounded-xl mb-8"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(240,180,41,0.06) 0%, transparent 55%)" }} />
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(240,180,41,0.12)", color: "#fbbf24" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v16m8-8H4"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">New Invoice</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                GST-compliant PDF with CGST/SGST or IGST based on buyer state. Buyer name autocompletes from past records.
              </p>
            </div>
          </div>
          <InvoiceForm buyerSuggestions={buyerSuggestions} />
        </div>
      </section>

      <InvoiceDatabase invoices={dbRows} />
    </div>
  );
}
