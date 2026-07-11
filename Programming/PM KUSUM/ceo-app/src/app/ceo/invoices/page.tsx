import Link from "next/link";
import { listInvoices } from "@/actions/invoices";
import { listClients } from "@/actions/clients";
import { InvoiceForm } from "@/components/invoice-form";
import { formatINR } from "@/lib/utils";

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  const [invoices, clients] = await Promise.all([listInvoices(), listClients()]);

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
          Tax invoices with BluRidge letterhead — sequence continues from INV-08.
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
          <Link
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#34d399" }}
            href={`/api/files/invoices/${sp.created}.pdf`}
            target="_blank"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Download PDF
          </Link>
        </div>
      )}

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
                GST-compliant PDF with CGST/SGST or IGST based on buyer state
              </p>
            </div>
          </div>
          <InvoiceForm clients={clients} />
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
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          <table className="data">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.02)" }}>
                <th>Invoice No.</th>
                <th>Buyer</th>
                <th>Date</th>
                <th>Taxable</th>
                <th>Grand Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <span className="font-mono font-semibold text-sm" style={{ color: "#818cf8" }}>
                      {inv.number}
                    </span>
                  </td>
                  <td>
                    <p className="font-medium text-sm">{inv.buyerName}</p>
                    {inv.remarks && (
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{inv.remarks}</p>
                    )}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    {inv.invoiceDate.toLocaleDateString("en-IN")}
                  </td>
                  <td className="tabular-nums text-sm">{formatINR(inv.taxableTotal)}</td>
                  <td>
                    <span className="tabular-nums font-semibold" style={{ color: "#fbbf24" }}>
                      {formatINR(inv.grandTotal)}
                    </span>
                  </td>
                  <td>
                    {inv.filePath && (
                      <Link
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: "rgba(240,180,41,0.08)", border: "1px solid rgba(240,180,41,0.2)", color: "#fbbf24" }}
                        href={`/api/files/${inv.filePath}`}
                        target="_blank"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        PDF
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12">
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
