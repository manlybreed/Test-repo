import { getFreeBusy, type BusyBlock } from "@/lib/calendar/google";

/**
 * India Standard Time has no daylight-saving transitions — a fixed
 * +5:30 offset, always — so shifting a UTC timestamp by this constant
 * and reading UTC fields back off the shifted Date is exact, unlike
 * Intl.DateTimeFormat's hour12 formatting (which prints midnight as
 * "24" in some locales) or relying on the server's own local timezone.
 */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function toIstParts(iso: string): { hour: number; minute: number; day: number } {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    day: shifted.getUTCDay(),
  };
}

function roundUpToStep(ms: number, stepMs: number): number {
  return Math.ceil(ms / stepMs) * stepMs;
}

export type CandidateSlot = { startIso: string; endIso: string };

/**
 * Pure: walks the [timeMinIso, timeMaxIso) range in stepMins increments,
 * keeps only slots inside IST work hours on weekdays that don't overlap
 * any busy block. This is the actual "never invent a time" guarantee —
 * candidate generation is code, not model output; an AI layer may only
 * ever pick from (and phrase) what this function already confirmed is
 * really open.
 */
export function generateCandidateSlots(
  busy: BusyBlock[],
  opts: {
    timeMinIso: string;
    timeMaxIso: string;
    durationMins: number;
    stepMins?: number;
    workStartHour?: number;
    workEndHour?: number;
    maxCandidates?: number;
  },
): CandidateSlot[] {
  const stepMs = (opts.stepMins ?? 30) * 60 * 1000;
  const workStart = opts.workStartHour ?? 9;
  const workEnd = opts.workEndHour ?? 18;
  const maxCandidates = opts.maxCandidates ?? 10;
  const durationMs = opts.durationMins * 60 * 1000;

  const busyRanges = busy
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));

  const rangeStart = new Date(opts.timeMinIso).getTime();
  const rangeEnd = new Date(opts.timeMaxIso).getTime();

  const candidates: CandidateSlot[] = [];
  for (
    let t = roundUpToStep(rangeStart, stepMs);
    t + durationMs <= rangeEnd;
    t += stepMs
  ) {
    const { hour, day } = toIstParts(new Date(t).toISOString());
    if (day === 0 || day === 6) continue; // weekend
    if (hour < workStart || hour >= workEnd) continue;

    const slotEnd = t + durationMs;
    const overlaps = busyRanges.some((b) => t < b.end && slotEnd > b.start);
    if (overlaps) continue;

    candidates.push({
      startIso: new Date(t).toISOString(),
      endIso: new Date(slotEnd).toISOString(),
    });
    if (candidates.length >= maxCandidates) break;
  }

  return candidates;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Pure: "Tue, Jul 29 · 10:00 AM IST" — deterministic, no LLM involved. */
export function formatSlotForDisplay(slot: CandidateSlot): string {
  const { hour, minute, day } = toIstParts(slot.startIso);
  const shifted = new Date(new Date(slot.startIso).getTime() + IST_OFFSET_MS);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "AM" : "PM";
  const mm = String(minute).padStart(2, "0");
  return `${WEEKDAY_NAMES[day]}, ${MONTH_NAMES[shifted.getUTCMonth()]} ${shifted.getUTCDate()} · ${h12}:${mm} ${ampm} IST`;
}

export type MeetingSlotOption = CandidateSlot & { label: string };

/**
 * Real, connected-calendar-grounded candidate meeting times — used both
 * by the assistant's check_calendar_availability tool path and by
 * draftReply's optional availability grounding. Returns [] (not an
 * error) when this account has no Google Calendar connection, so callers
 * can silently skip offering times rather than fail.
 */
export async function getCandidateMeetingSlots(
  accountId: string,
  opts?: { durationMins?: number; withinDays?: number; maxCandidates?: number },
): Promise<MeetingSlotOption[]> {
  const durationMins = opts?.durationMins ?? 30;
  const withinDays = opts?.withinDays ?? 5;
  const timeMin = new Date();
  const timeMax = new Date(timeMin.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const result = await getFreeBusy(accountId, timeMin.toISOString(), timeMax.toISOString());
  if (!result) return [];

  const candidates = generateCandidateSlots(result.busy, {
    timeMinIso: timeMin.toISOString(),
    timeMaxIso: timeMax.toISOString(),
    durationMins,
    maxCandidates: opts?.maxCandidates ?? 3,
  });

  return candidates.map((c) => ({ ...c, label: formatSlotForDisplay(c) }));
}
