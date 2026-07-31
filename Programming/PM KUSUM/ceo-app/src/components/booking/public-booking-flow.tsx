"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  createPublicBookingAction,
  getPublicBookingSlotsAction,
  type PublicBookingInfo,
} from "@/actions/public-booking";
import type { MeetingSlotOption } from "@/lib/calendar/propose-times";

const spring = { type: "spring" as const, stiffness: 420, damping: 32 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FoundInfo = Extract<PublicBookingInfo, { found: true }>;
type Step = "duration" | "slot" | "details" | "success";

function groupSlotsByDay(slots: MeetingSlotOption[]): [string, { slot: MeetingSlotOption; time: string }[]][] {
  const map = new Map<string, { slot: MeetingSlotOption; time: string }[]>();
  for (const s of slots) {
    const [day, time] = s.label.split(" · ");
    const list = map.get(day) ?? [];
    list.push({ slot: s, time: time ?? s.label });
    map.set(day, list);
  }
  return Array.from(map.entries());
}

export function PublicBookingFlow({ slug, initial }: { slug: string; initial: FoundInfo }) {
  const [pending, startTransition] = useTransition();
  const [duration, setDuration] = useState(initial.durationOptions[0]);
  const [slots, setSlots] = useState<MeetingSlotOption[]>(initial.slots);
  const [step, setStep] = useState<Step>(initial.durationOptions.length > 1 ? "duration" : "slot");
  const [selectedSlot, setSelectedSlot] = useState<MeetingSlotOption | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ htmlLink: string; meetLink: string | null } | null>(null);

  function pickDuration(d: number) {
    setError("");
    if (d === duration && slots.length) {
      setDuration(d);
      setStep("slot");
      return;
    }
    setDuration(d);
    startTransition(async () => {
      const info = await getPublicBookingSlotsAction(slug, d);
      setSlots(info.found ? info.slots : []);
      setStep("slot");
    });
  }

  function pickSlot(slot: MeetingSlotOption) {
    setSelectedSlot(slot);
    setError("");
    setStep("details");
  }

  function submit() {
    if (!selectedSlot) return;
    if (!name.trim() || !EMAIL_RE.test(email.trim())) {
      setError("Enter your name and a valid email address.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await createPublicBookingAction({
        slug,
        startIso: selectedSlot.startIso,
        endIso: selectedSlot.endIso,
        visitorName: name,
        visitorEmail: email,
        note: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setResult({ htmlLink: res.htmlLink, meetLink: res.meetLink });
      setStep("success");
    });
  }

  const grouped = groupSlotsByDay(slots);

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="rounded-2xl p-6"
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
        }}
      >
        {step !== "success" && (
          <div className="mb-5">
            <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
              {initial.title}
            </h1>
            {initial.description && (
              <p className="mt-1 text-sm" style={{ color: "var(--text-dim)" }}>
                {initial.description}
              </p>
            )}
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === "duration" && (
            <motion.div
              key="duration"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={spring}
            >
              <p className="mb-2 text-xs" style={{ color: "var(--text-dim)" }}>
                How long?
              </p>
              <div className="flex flex-wrap gap-2">
                {initial.durationOptions.map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={pending}
                    className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      background: "var(--bg-hover)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                    }}
                    onClick={() => pickDuration(d)}
                  >
                    {d} min
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {step === "slot" && (
            <motion.div
              key="slot"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={spring}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                  Pick a time ({duration} min, IST)
                </p>
                {initial.durationOptions.length > 1 && (
                  <button
                    type="button"
                    className="cursor-pointer text-xs"
                    style={{ color: "var(--accent-bright)" }}
                    onClick={() => setStep("duration")}
                  >
                    Change length
                  </button>
                )}
              </div>

              {pending && (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Loading times…
                </p>
              )}

              {!pending && grouped.length === 0 && (
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  No open times right now — please check back later.
                </p>
              )}

              {!pending && grouped.length > 0 && (
                <div className="max-h-80 space-y-3 overflow-auto pr-1">
                  {grouped.map(([day, items]) => (
                    <div key={day}>
                      <p className="mb-1.5 text-xs font-semibold" style={{ color: "var(--text-muted)" }}>
                        {day}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map(({ slot, time }) => (
                          <button
                            key={slot.startIso}
                            type="button"
                            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium"
                            style={{
                              background: "var(--accent-dim)",
                              color: "var(--accent-bright)",
                              border: "1px solid transparent",
                            }}
                            onClick={() => pickSlot(slot)}
                          >
                            {time}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {step === "details" && selectedSlot && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={spring}
            >
              <div
                className="mb-4 rounded-lg px-3 py-2.5 text-sm"
                style={{ background: "var(--bg-hover)", color: "var(--text)" }}
              >
                {selectedSlot.label} · {duration} min
              </div>

              <div className="space-y-3">
                <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                  Your name
                  <input
                    className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--bg-hover)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                  Email
                  <input
                    type="email"
                    className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--bg-hover)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block text-xs" style={{ color: "var(--text-dim)" }}>
                  What&apos;s this about? (optional)
                  <textarea
                    className="mt-1 w-full cursor-text rounded-lg px-3 py-2.5 text-sm outline-none"
                    style={{ background: "var(--bg-hover)", border: "1px solid var(--border-strong)", color: "var(--text)", resize: "vertical", minHeight: "60px" }}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
              </div>

              {error && (
                <p className="mt-3 text-xs" style={{ color: "#f87171" }}>
                  {error}
                </p>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  className="cursor-pointer rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: "linear-gradient(135deg, var(--accent), var(--navy-bright))",
                    color: "#fff",
                    border: "1px solid rgba(129,140,248,0.45)",
                  }}
                  onClick={submit}
                >
                  {pending ? "Booking…" : "Confirm booking"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  className="cursor-pointer rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: "transparent", color: "var(--text-dim)", border: "1px solid var(--border)" }}
                  onClick={() => setStep("slot")}
                >
                  Back
                </button>
              </div>
            </motion.div>
          )}

          {step === "success" && result && selectedSlot && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="text-center"
            >
              <h2 className="text-lg font-semibold" style={{ color: "#4ade80" }}>
                You&apos;re booked!
              </h2>
              <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>
                {initial.title} — {selectedSlot.label}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--text-dim)" }}>
                A calendar invite is on its way to {email}.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {result.meetLink && (
                  <a
                    href={result.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg px-3 py-1.5 text-xs font-medium"
                    style={{ background: "var(--accent-dim)", color: "var(--accent-bright)" }}
                  >
                    Join Meet
                  </a>
                )}
                <a
                  href={result.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg px-3 py-1.5 text-xs"
                  style={{ background: "var(--bg-hover)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                >
                  View in Google Calendar
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
