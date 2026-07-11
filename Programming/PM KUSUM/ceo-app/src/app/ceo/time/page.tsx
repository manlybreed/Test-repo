import { listTasks, getActiveSession, getWeeklySummary } from "@/actions/time";
import { TimeTracker } from "@/components/time-tracker";

export default async function TimePage() {
  const [tasks, active, weekly] = await Promise.all([
    listTasks(),
    getActiveSession(),
    getWeeklySummary(),
  ]);

  const doneTasks = tasks.filter((t) => t.status === "DONE").length;
  const openTasks = tasks.filter((t) => t.status !== "DONE").length;
  const weeklyHrs = (weekly.totalSec / 3600).toFixed(1);

  return (
    <div>
      <header className="mb-8">
        <p className="text-[0.6rem] tracking-[0.26em] uppercase mb-2 font-semibold"
          style={{ color: "var(--text-dim)" }}>
          Module · Time
        </p>
        <h1 className="text-[2.2rem] font-bold tracking-tight leading-none mb-3">
          <span className="grad-text">Time Tracker</span>
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Personal task list, Pomodoro focus sessions, and weekly hours.
        </p>
      </header>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Open tasks",   value: String(openTasks),    color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
          { label: "Completed",    value: String(doneTasks),    color: "#34d399", bg: "rgba(16,185,129,0.08)" },
          { label: "This week",    value: `${weeklyHrs}h`,      color: "#818cf8", bg: "rgba(99,102,241,0.08)" },
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

      <section className="relative overflow-hidden rounded-xl"
        style={{ background: "var(--bg-panel)", border: "1px solid var(--border)" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 50% 60% at 0% 0%, rgba(251,146,60,0.06) 0%, transparent 55%)" }} />
        <div className="relative p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: "rgba(251,146,60,0.12)", color: "#fb923c" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold">Tasks & Pomodoro</h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>
                {active ? "🔴 Session active" : "No active session"}
              </p>
            </div>
          </div>
          <TimeTracker
            tasks={tasks}
            active={active ? { id: active.id, startedAt: active.startedAt, task: active.task } : null}
            weeklyTotalSec={weekly.totalSec}
            byTag={weekly.byTag}
          />
        </div>
      </section>
    </div>
  );
}
