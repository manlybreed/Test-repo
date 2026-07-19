import {
  getLedgerSummary,
  listAdvanceEntries,
  listAuditLogs,
  listInwardEntries,
  listItcEntries,
  listOutwardEntries,
} from "@/actions/ledgers";
import { LedgersClient } from "@/components/ledgers-client";
import { financialYearFromDate } from "@/lib/invoice/financial-year";

export default async function LedgersPage() {
  const fy = financialYearFromDate(new Date());
  const [summary, outward, inward, itc, advance, audit] = await Promise.all([
    getLedgerSummary({ financialYear: fy }),
    listOutwardEntries({ financialYear: fy, includeStruck: true }),
    listInwardEntries({ financialYear: fy, includeStruck: true }),
    listItcEntries({ financialYear: fy }),
    listAdvanceEntries({ financialYear: fy }),
    listAuditLogs(150),
  ]);

  return (
    <div>
      <header className="mb-8">
        <p
          className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}
        >
          Module · GST Books
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Ledgers &amp; registers</span>
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: "var(--text-muted)" }}>
          Rule 56 outward / inward / ITC / advance registers for FY {fy}. Append-only
          books with strike corrections and on-demand CSV export.
        </p>
      </header>

      <LedgersClient
        summary={summary}
        financialYear={fy}
        outward={outward.map(serialize)}
        inward={inward.map(serialize)}
        itc={itc.map(serialize)}
        advance={advance.map(serialize)}
        audit={audit.map(serialize)}
      />
    </div>
  );
}

function serialize<T extends object>(row: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}
