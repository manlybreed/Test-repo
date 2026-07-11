"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createTask, startPomodoro, stopActiveSession, updateTaskStatus, logManualTime } from "@/actions/time";

type Task = {
  id: string;
  title: string;
  projectTag: string | null;
  clientTag: string | null;
  status: string;
  estimateMin: number | null;
  sessions: { durationSec: number | null }[];
};

type Active = {
  id: string;
  startedAt: string | Date;
  task: { title: string } | null;
} | null;

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* Circular progress ring */
function Ring({
  progress,
  size = 140,
  stroke = 5,
  color = "var(--navy-bright)",
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
}) {
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(1, progress));
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        initial={false}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1, ease: "linear" }}
      />
    </svg>
  );
}

export function TimeTracker({
  tasks,
  active,
  weeklyTotalSec,
  byTag,
}: {
  tasks: Task[];
  active: Active;
  weeklyTotalSec: number;
  byTag: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [projectTag, setProjectTag] = useState("");
  const [clientTag, setClientTag] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [pomodoroMin, setPomodoroMin] = useState(25);

  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const started = new Date(active.startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - started) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active]);

  const totalSec = pomodoroMin * 60;
  const remaining = Math.max(0, totalSec - elapsed);
  const progress = active ? elapsed / totalSec : 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  const isOver = active && remaining === 0;

  function addTask(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      await createTask({ title, projectTag, clientTag });
      setTitle("");
      router.refresh();
    });
  }

  const activeTasks = tasks.filter((t) => t.status !== "DONE");
  const doneTasks = tasks.filter((t) => t.status === "DONE");

  return (
    <div className="space-y-8">
      {/* Pomodoro timer */}
      <section className="panel p-6 flex flex-col sm:flex-row items-center gap-8">
        <div className="relative flex items-center justify-center">
          <Ring progress={progress} size={150} stroke={6} color={isOver ? "#c06060" : "var(--navy-bright)"} />
          <div className="absolute flex flex-col items-center">
            <span
              className="text-3xl font-semibold tabular-nums tracking-tight"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {active ? `${mm}:${ss}` : `${String(pomodoroMin).padStart(2, "0")}:00`}
            </span>
            {isOver && <span className="text-xs mt-1" style={{ color: "#e07070" }}>Done!</span>}
          </div>
        </div>

        <div className="flex-1 space-y-4">
          <div>
            <p className="text-[0.65rem] tracking-[0.18em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
              {active ? `Focused on` : "Ready"}
            </p>
            <p className="text-lg font-medium">
              {active ? (active.task?.title || "Untitled session") : "No active session"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="label">Minutes</label>
              <input
                className="input w-24"
                type="number"
                min={5}
                max={90}
                value={pomodoroMin}
                disabled={!!active}
                onChange={(e) => setPomodoroMin(Number(e.target.value))}
              />
            </div>
            {active ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ marginTop: "1.25rem", borderColor: "var(--danger)", color: "#c08080" }}
                disabled={pending}
                onClick={() => start(async () => { await stopActiveSession(); router.refresh(); })}
              >
                Stop session
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: "1.25rem" }}
                disabled={pending}
                onClick={() => start(async () => { await startPomodoro(); router.refresh(); })}
              >
                Start focus
              </button>
            )}
          </div>
        </div>

        {/* Weekly stats */}
        <div className="panel p-4 w-full sm:w-48 shrink-0">
          <p className="text-[0.6rem] tracking-[0.18em] uppercase mb-1" style={{ color: "var(--text-dim)" }}>
            This week
          </p>
          <p className="text-2xl font-semibold tabular-nums">{fmt(weeklyTotalSec)}</p>
          <div className="mt-3 space-y-1.5">
            {Object.entries(byTag)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 4)
              .map(([tag, sec]) => (
                <div key={tag} className="flex justify-between text-xs gap-2">
                  <span className="truncate" style={{ color: "var(--text-muted)" }}>{tag}</span>
                  <span className="tabular-nums shrink-0">{fmt(sec)}</span>
                </div>
              ))}
          </div>
        </div>
      </section>

      {/* New task */}
      <section className="panel p-5">
        <h2 className="text-base font-semibold mb-4">New task</h2>
        <form onSubmit={addTask} className="grid sm:grid-cols-5 gap-3">
          <input
            className="input sm:col-span-2"
            placeholder="Task title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className="input"
            placeholder="Project"
            value={projectTag}
            onChange={(e) => setProjectTag(e.target.value)}
          />
          <input
            className="input"
            placeholder="Client"
            value={clientTag}
            onChange={(e) => setClientTag(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={pending}>Add</button>
        </form>
      </section>

      {/* Tasks table */}
      <section>
        <h2 className="text-base font-semibold mb-3">Active tasks ({activeTasks.length})</h2>
        <div className="panel overflow-hidden">
          <table className="data">
            <thead>
              <tr>
                <th>Task</th>
                <th>Tags</th>
                <th>Logged</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {activeTasks.map((t) => {
                  const logged = t.sessions.reduce((s, x) => s + (x.durationSec || 0), 0);
                  return (
                    <tr key={t.id}>
                      <td className="font-medium">{t.title}</td>
                      <td className="text-sm" style={{ color: "var(--text-muted)" }}>
                        {[t.projectTag, t.clientTag].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="tabular-nums">{fmt(logged)}</td>
                      <td>
                        <select
                          className="input py-1 text-xs"
                          style={{ maxWidth: "120px" }}
                          value={t.status}
                          onChange={(e) =>
                            start(async () => {
                              await updateTaskStatus(t.id, e.target.value as "TODO" | "IN_PROGRESS" | "DONE");
                              router.refresh();
                            })
                          }
                        >
                          <option value="TODO">To do</option>
                          <option value="IN_PROGRESS">In progress</option>
                          <option value="DONE">Done</option>
                        </select>
                      </td>
                      <td className="space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={pending || !!active}
                          onClick={() => start(async () => { await startPomodoro(t.id); router.refresh(); })}
                        >
                          Focus
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost text-xs"
                          disabled={pending}
                          onClick={() => start(async () => { await logManualTime({ taskId: t.id, durationMin: 15 }); router.refresh(); })}
                        >
                          +15m
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </AnimatePresence>
              {activeTasks.length === 0 && (
                <tr><td colSpan={5} className="text-muted">No active tasks. Add one above.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {doneTasks.length > 0 && (
          <details className="mt-4">
            <summary className="text-sm cursor-pointer" style={{ color: "var(--text-muted)" }}>
              {doneTasks.length} completed task{doneTasks.length !== 1 ? "s" : ""}
            </summary>
            <div className="panel overflow-hidden mt-2">
              <table className="data">
                <tbody>
                  {doneTasks.map((t) => (
                    <tr key={t.id} style={{ opacity: 0.55 }}>
                      <td className="line-through">{t.title}</td>
                      <td className="text-sm" style={{ color: "var(--text-dim)" }}>
                        {[t.projectTag, t.clientTag].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="tabular-nums">
                        {fmt(t.sessions.reduce((s, x) => s + (x.durationSec || 0), 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
