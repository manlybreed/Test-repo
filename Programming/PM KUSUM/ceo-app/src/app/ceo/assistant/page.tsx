import { AssistantChat } from "@/components/assistant-chat";

export default function AssistantPage() {
  return (
    <div>
      <header className="mb-8">
        <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}>
          Module · AI
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">CEO Assistant</span>
        </h1>
        <p className="text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Claude-powered — creates agreements, GST invoices, salary slips, and manages tasks.
          Just describe what you need.
        </p>
      </header>

      {/* Tips */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        {[
          { tip: "Create agreement for BSS Eco Solar, 2% success fee", icon: "◈", color: "#818cf8", bg: "rgba(99,102,241,0.08)" },
          { tip: "Invoice INV-09 for Rajasthan Discoms ₹1,50,000", icon: "◇", color: "#fbbf24", bg: "rgba(240,180,41,0.06)" },
          { tip: "Generate July salary slip for Akshay Royal", icon: "◉", color: "#34d399", bg: "rgba(16,185,129,0.06)" },
        ].map((t) => (
          <div key={t.tip} className="flex items-start gap-3 p-3.5 rounded-xl"
            style={{ background: t.bg, border: `1px solid ${t.color}22` }}>
            <span className="text-sm shrink-0 mt-0.5" style={{ color: t.color }}>{t.icon}</span>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              &ldquo;{t.tip}&rdquo;
            </p>
          </div>
        ))}
      </div>

      <section className="relative overflow-hidden rounded-xl"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 40% 50% at 0% 0%, rgba(99,102,241,0.07) 0%, transparent 55%)" }} />
        <div className="relative">
          <AssistantChat />
        </div>
      </section>
    </div>
  );
}
