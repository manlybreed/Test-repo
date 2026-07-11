import Link from "next/link";
import { listAgreements } from "@/actions/agreements";
import { listClients } from "@/actions/clients";
import { AgreementForm } from "@/components/agreement-form";
import { formatINR } from "@/lib/utils";

export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  const [agreements, clients] = await Promise.all([listAgreements(), listClients()]);

  const totalTokenFees = agreements.reduce((s, a) => s + a.tokenFeePerPlant * a.plantCount, 0);
  const finalCount = agreements.filter((a) => a.status === "FINAL").length;
  const draftCount = agreements.filter((a) => a.status === "DRAFT").length;

  return (
    <div>
      {/* Header */}
      <header className="mb-8">
        <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}>
          Module · Agreements
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">PM KUSUM Agreements</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Finance Advisory & Mandate agreements using the BluRidge template DOCX — client details auto-filled.
        </p>
      </header>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total", value: agreements.length, color: "#818cf8", bg: "rgba(99,102,241,0.1)" },
          { label: "Final", value: finalCount,         color: "#34d399", bg: "rgba(16,185,129,0.1)" },
          { label: "Draft", value: draftCount,         color: "#fbbf24", bg: "rgba(245,158,11,0.1)" },
        ].map((s) => (
          <div key={s.label} className="relative overflow-hidden rounded-xl p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)` }} />
            <p className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
              style={{ color: "var(--text-dim)" }}>{s.label}</p>
            <p className="relative text-3xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Success toast */}
      {sp.created && (
        <div className="flex items-center justify-between px-4 py-3 rounded-xl mb-6 text-sm"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", color: "#34d399" }}>
          <div className="flex items-center gap-2">
            <span className="text-base">✓</span>
            Agreement generated — find it in the library below.
          </div>
        </div>
      )}

      {/* New agreement form */}
      <section className="relative overflow-hidden rounded-xl mb-8"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(99,102,241,0.07) 0%, transparent 55%)" }} />
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v16m8-8H4"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">New Agreement</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                Template DOCX will be generated with client details
              </p>
            </div>
          </div>
          <AgreementForm clients={clients} />
        </div>
      </section>

      {/* Library */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Library</h2>
            <span className="text-xs px-2 py-0.5 rounded-md tabular-nums"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8" }}>
              {agreements.length}
            </span>
          </div>
          {totalTokenFees > 0 && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Token fees collected: <span className="font-semibold" style={{ color: "var(--text)" }}>{formatINR(totalTokenFees)}</span>
            </span>
          )}
        </div>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
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
              {agreements.map((a) => (
                <tr key={a.id}>
                  <td className="font-medium">{a.clientName}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>{a.spvName || "—"}</td>
                  <td className="tabular-nums text-sm">{formatINR(a.tokenFeePerPlant * a.plantCount)}</td>
                  <td className="tabular-nums text-sm">
                    <span style={{ color: "#818cf8" }}>{a.successFeePct}%</span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                    {a.effectiveDate.toLocaleDateString("en-IN")}
                  </td>
                  <td>
                    <span className={`badge ${a.status === "FINAL" ? "badge-final" : "badge-draft"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td>
                    {a.filePath && (
                      <Link
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", color: "#818cf8" }}
                        href={`/api/files/${a.filePath}`}
                        target="_blank"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        DOCX
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
              {agreements.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <p style={{ color: "var(--text-dim)" }}>No agreements yet — create your first one above.</p>
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
