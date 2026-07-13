import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/utils";
import { DailyQuote } from "@/components/daily-quote";
import { GreetingHeader } from "@/components/greeting-header";
import { requireCeo, currentUserIsFinanceOwner } from "@/lib/session";

export default async function CeoOverviewPage() {
  const session = await requireCeo();
  const financeOwner = await currentUserIsFinanceOwner();
  const [agreements, invoices, employees, openTasks, invoiceAgg] =
    await Promise.all([
      financeOwner ? prisma.agreement.count() : Promise.resolve(0),
      prisma.invoice.count(),
      prisma.employee.count({ where: { active: true } }),
      prisma.task.count({ where: { status: { not: "DONE" } } }),
      prisma.invoice.aggregate({ _sum: { grandTotal: true } }),
    ]);

  const metrics = [
    ...(financeOwner
      ? [
          {
            label: "Agreements",
            value: String(agreements),
            href: "/ceo/agreements",
            hint: "PM KUSUM mandates",
            accent: "rgba(99,102,241,0.15)",
            iconColor: "#818cf8",
            icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
            ),
          },
        ]
      : []),
    {
      label: "Total billed",
      value: invoiceAgg._sum.grandTotal ? formatINR(invoiceAgg._sum.grandTotal) : `${invoices}`,
      href: "/ceo/invoices",
      hint: `${invoices} GST invoices`,
      accent: "rgba(240,180,41,0.1)",
      iconColor: "#fbbf24",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
        </svg>
      ),
    },
    {
      label: "Active staff",
      value: String(employees),
      href: "/ceo/payroll",
      hint: "Salary slips ready",
      accent: "rgba(16,185,129,0.1)",
      iconColor: "#34d399",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
        </svg>
      ),
    },
    {
      label: "Open tasks",
      value: String(openTasks),
      href: "/ceo/time",
      hint: "Pomodoro & tracking",
      accent: "rgba(251,146,60,0.1)",
      iconColor: "#fb923c",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      ),
    },
  ];

  return (
    <div>
      {/* Greeting */}
      <GreetingHeader name={session.user?.name} />

      {/* Quote card */}
      <DailyQuote />

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {metrics.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="group relative overflow-hidden rounded-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <div
              className="absolute inset-0 opacity-70 transition-opacity duration-200 group-hover:opacity-100"
              style={{ background: `radial-gradient(ellipse 100% 80% at 0% 0%, ${m.accent} 0%, transparent 60%)` }}
            />
            <div className="relative p-5">
              <div className="flex items-center justify-between mb-4">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center"
                  style={{ background: m.accent, color: m.iconColor }}
                >
                  {m.icon}
                </div>
                <span className="text-[0.58rem] tracking-[0.12em] uppercase font-semibold"
                  style={{ color: "var(--text-dim)" }}>
                  {m.label}
                </span>
              </div>
              <p className="text-[1.85rem] font-bold tabular-nums leading-none tracking-tight">{m.value}</p>
              <p className="text-xs mt-2 flex items-center justify-between" style={{ color: "var(--text-muted)" }}>
                <span>{m.hint}</span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: m.iconColor }}>→</span>
              </p>
            </div>
          </Link>
        ))}
      </div>

      {/* AI Assistant CTA */}
      <div
        className="relative overflow-hidden rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-5 mb-6"
        style={{
          background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(13,15,20,0.5) 70%)",
          border: "1px solid rgba(99,102,241,0.18)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 45% 130% at 0% 50%, rgba(99,102,241,0.14) 0%, transparent 55%)" }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5 mb-2">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "rgba(99,102,241,0.2)", color: "#818cf8" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
              </svg>
            </div>
            <h2 className="text-base font-semibold">CEO Assistant</h2>
          </div>
          <p className="text-sm max-w-lg" style={{ color: "var(--text-muted)" }}>
            &ldquo;Create an agreement for BSS Eco Solar…&rdquo; · &ldquo;Invoice INV-09 for ₹1,00,000&rdquo; · &ldquo;Generate July slips&rdquo;
          </p>
        </div>
        <Link href="/ceo/assistant" className="btn btn-primary relative shrink-0">
          Open assistant →
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          ...(financeOwner
            ? [
                {
                  label: "New agreement",
                  href: "/ceo/agreements",
                  sub: "DOCX via template",
                  color: "#818cf8",
                },
              ]
            : []),
          { label: "New invoice",   href: "/ceo/invoices",   sub: "GST PDF",            color: "#fbbf24" },
          { label: "Salary slips",  href: "/ceo/payroll",    sub: "Monthly payroll run", color: "#34d399" },
        ].map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-3 p-4 rounded-xl transition-all duration-150 hover:-translate-y-0.5"
            style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}
          >
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{a.label}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{a.sub}</p>
            </div>
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-sm" style={{ color: a.color }}>→</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
