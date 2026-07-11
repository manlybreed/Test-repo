import { listExpenses, getExpenseSummary } from "@/actions/expenses";
import { getCategoryById, EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { ExpensesClient } from "./client";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const sp = await searchParams;
  const [expenses, summary] = await Promise.all([
    listExpenses(sp.cat),
    getExpenseSummary(),
  ]);

  return (
    <div>
      {/* Header */}
      <header className="mb-8">
        <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}>
          Module · Expenses
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Expense Manager</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Upload any bill or invoice — Claude reads it, extracts the details, and auto-categorises it.
        </p>
      </header>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Total expenses",    value: `₹${(summary.total / 1000).toFixed(1)}K`,    color: "#f87171", bg: "rgba(248,113,113,0.1)" },
          { label: "This month",        value: `₹${(summary.thisMonth / 1000).toFixed(1)}K`, color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
          { label: "Total records",     value: String(summary.count),                         color: "#818cf8", bg: "rgba(99,102,241,0.08)" },
          { label: "Needs review",      value: String(summary.needsReview),                   color: summary.needsReview > 0 ? "#fbbf24" : "#34d399", bg: summary.needsReview > 0 ? "rgba(251,191,36,0.08)" : "rgba(16,185,129,0.08)" },
        ].map((s) => (
          <div key={s.label} className="relative overflow-hidden rounded-xl p-4"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
            <div className="absolute inset-0 pointer-events-none"
              style={{ background: `radial-gradient(ellipse 80% 80% at 0% 0%, ${s.bg} 0%, transparent 65%)` }} />
            <p className="relative text-[0.6rem] tracking-[0.15em] uppercase font-semibold mb-2"
              style={{ color: "var(--text-dim)" }}>{s.label}</p>
            <p className="relative text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Category breakdown */}
      {Object.keys(summary.byCategory).length > 0 && (
        <div className="mb-8 rounded-xl overflow-hidden"
          style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-sm font-semibold">Spending by Category</h2>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(summary.byCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([catId, amt]) => {
                const cat = getCategoryById(catId);
                const pct = summary.total > 0 ? (amt / summary.total) * 100 : 0;
                return (
                  <a key={catId} href={`?cat=${catId}`}
                    className="flex items-center gap-2.5 p-3 rounded-lg transition-all"
                    style={{ background: cat.bg, border: `1px solid ${cat.color}22` }}>
                    <span className="text-lg shrink-0">{cat.icon}</span>
                    <div className="min-w-0">
                      <p className="text-[0.7rem] font-medium truncate" style={{ color: cat.color }}>{cat.label}</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: "var(--text)" }}>
                        ₹{Number(amt).toLocaleString("en-IN")}
                      </p>
                      <div className="h-1 mt-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cat.color }} />
                      </div>
                    </div>
                  </a>
                );
              })}
          </div>
        </div>
      )}

      {/* Client section: upload + table */}
      <ExpensesClient
        expenses={expenses.map((e) => ({
          id:          e.id,
          date:        e.date.toISOString().split("T")[0],
          vendor:      e.vendor,
          amount:      Number(e.amount),
          category:    e.category,
          description: e.description ?? undefined,
          paymentMode: e.paymentMode ?? undefined,
          invoiceNo:   e.invoiceNo ?? undefined,
          filePath:    e.filePath ?? undefined,
          needsReview: e.needsReview,
          gstAmount:   e.gstAmount ? Number(e.gstAmount) : undefined,
          gstEntity:   e.gstEntity ?? null,
          notes:       e.notes ?? undefined,
        }))}
        activeFilter={sp.cat}
      />
    </div>
  );
}
