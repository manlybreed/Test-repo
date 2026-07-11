import Link from "next/link";
import { listInvoices } from "@/actions/invoices";
import { listClients } from "@/actions/clients";
import { prisma } from "@/lib/prisma";
import { InvoiceForm } from "@/components/invoice-form";
import { ImportSection } from "./import-section";
import { InvoiceStatusCell } from "@/components/invoice-status-cell";
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

  // Detect duplicate invoice numbers in DB (shouldn't happen but flag if so)
  const numCount = new Map<string, number>();
  for (const inv of invoices) numCount.set(inv.number, (numCount.get(inv.number) ?? 0) + 1);
  const hasDupes = [...numCount.values()].some((v) => v > 1);

  const totalTaxable  = invoices.reduce((s, i) => s + i.taxableTotal, 0);
  const totalGrand    = invoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalTax      = totalGrand - totalTaxable;

  return (
    <div>
      {/* Header */}
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

      {/* Stat row */}
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

      {/* Success toast */}
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
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 110 6 3 3 0 010-6z"/></svg>
              View
            </Link>
            <Link
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}
              href={`/api/files/invoices/${sp.created}.pdf`}
              download={`${sp.created}.pdf`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              Download
            </Link>
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {hasDupes && (
        <div className="px-4 py-3 rounded-xl mb-6 text-sm"
          style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", color: "#fbbf24" }}>
          ⚠ Duplicate invoice numbers detected in the database. Please review the history table below.
        </div>
      )}

      {/* Import section */}
      <ImportSection />

      {/* New invoice form */}
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
          <InvoiceForm clients={clients} buyerSuggestions={buyerSuggestions} />
        </div>
      </section>

      {/* History */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">History</h2>
            <span className="text-xs px-2 py-0.5 rounded-md tabular-nums"
              style={{ background: "rgba(240,180,41,0.1)", border: "1px solid rgba(240,180,41,0.2)", color: "#fbbf24" }}>
              {invoices.length}
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>
            Click a status badge to update payment status · TDS button toggles deduction
          </p>
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="data">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th>Invoice No.</th>
                <th>Buyer</th>
                <th>Date</th>
                <th>Status / TDS</th>
                <th>Taxable</th>
                <th>Grand Total</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const isDupe = (numCount.get(inv.number) ?? 0) > 1;
                const extInv = inv as typeof inv & {
                  dueDate?: Date | null;
                  serviceDesc?: string | null;
                  sourceFilePath?: string | null;
                  tdsDeducted: boolean;
                  tdsAmount: number | null;
                };
                return (
                  <tr key={inv.id} style={isDupe ? { background: "rgba(251,191,36,0.04)" } : undefined}>
                    <td>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-semibold text-sm" style={{ color: isDupe ? "#fbbf24" : "#818cf8" }}>
                          {inv.number}
                        </span>
                        {isDupe && (
                          <span className="text-[0.55rem] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }}>
                            DUPLICATE
                          </span>
                        )}
                        {inv.isImported && (
                          <span className="text-[0.55rem] px-1.5 py-0.5 rounded font-semibold"
                            style={{ background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>
                            IMPORTED
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <p className="font-medium text-sm">{inv.buyerName}</p>
                      {(inv.remarks || extInv.serviceDesc) && (
                        <p className="text-xs mt-0.5 truncate max-w-[200px]" style={{ color: "var(--text-dim)" }}>
                          {inv.remarks || extInv.serviceDesc}
                        </p>
                      )}
                    </td>
                    <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      <div>{inv.invoiceDate.toLocaleDateString("en-IN")}</div>
                      {extInv.dueDate && (
                        <div className="text-xs" style={{ color: "var(--text-dim)" }}>
                          Due {extInv.dueDate.toLocaleDateString("en-IN")}
                        </div>
                      )}
                    </td>
                    <td>
                      <InvoiceStatusCell
                        invoiceId={inv.id}
                        initialStatus={inv.paymentStatus ?? null}
                        initialTdsDeducted={extInv.tdsDeducted}
                        initialTdsAmount={extInv.tdsAmount}
                      />
                    </td>
                    <td className="tabular-nums text-sm">{formatINR(inv.taxableTotal)}</td>
                    <td>
                      <span className="tabular-nums font-semibold" style={{ color: "#fbbf24" }}>
                        {formatINR(inv.grandTotal)}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Generated PDF — View + Download */}
                        {inv.filePath && (
                          <>
                            <Link
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8" }}
                              href={`/api/files/${inv.filePath}`}
                              target="_blank"
                              title="View PDF"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 110 6 3 3 0 010-6z"/></svg>
                              View
                            </Link>
                            <Link
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                              style={{ background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.2)", color: "#fbbf24" }}
                              href={`/api/files/${inv.filePath}`}
                              download={`${inv.number}.pdf`}
                              title="Download PDF"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                              PDF
                            </Link>
                          </>
                        )}
                        {/* Original uploaded file — View + Download */}
                        {extInv.sourceFilePath && (
                          <>
                            <Link
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                              style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", color: "#34d399" }}
                              href={`/${extInv.sourceFilePath}`}
                              target="_blank"
                              title="View original invoice"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 110 6 3 3 0 010-6z"/></svg>
                              Orig
                            </Link>
                            <Link
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                              style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)", color: "#34d399" }}
                              href={`/${extInv.sourceFilePath}`}
                              download
                              title="Download original"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                              DL
                            </Link>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <p style={{ color: "var(--text-dim)" }}>No invoices yet — create your first one above.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
