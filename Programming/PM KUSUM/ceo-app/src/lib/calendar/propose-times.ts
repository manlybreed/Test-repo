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

/** One open IST time-window on a given weekday, in minutes-since-midnight
 * wall-clock time (e.g. 9am = 540, 6pm = 1080). */
export type WeeklyWindow = { startMin: number; endMin: number };
/** 0=Sun..6=Sat (matches JS Date#getDay()/getUTCDay()) — only the days
 * present have any open window at all. */
export type WeeklyWindows = Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, WeeklyWindow[]>>;

/**
 * Pure: walks the [timeMinIso, timeMaxIso) range in stepMins increments,
 * keeps only slots inside allowed hours that don't overlap any busy
 * block (padded by an optional buffer). This is the actual "never invent
 * a time" guarantee — candidate generation is code, not model output; an
 * AI layer may only ever pick from (and phrase) what this function
 * already confirmed is really open.
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
    /** When present, replaces the default weekday/9am-6pm window
     * entirely (weekends are allowed if a window exists for that day) —
     * used by public booking, where the CEO configures their own
     * schedule. Omitted for the existing AI/manual scheduling path,
     * which keeps today's hardcoded default unchanged. */
    weeklyWindows?: WeeklyWindows;
    /** Pads the busy-overlap check on either side of a candidate slot —
     * e.g. a 15-min buffer excludes a slot that would end right as a
     * meeting starts, not just ones that literally overlap it. */
    bufferBeforeMins?: number;
    bufferAfterMins?: number;
    maxCandidates?: number;
  },
): CandidateSlot[] {
  const stepMs = (opts.stepMins ?? 30) * 60 * 1000;
  const workStart = opts.workStartHour ?? 9;
  const workEnd = opts.workEndHour ?? 18;
  const maxCandidates = opts.maxCandidates ?? 10;
  const durationMs = opts.durationMins * 60 * 1000;
  const bufferBeforeMs = (opts.bufferBeforeMins ?? 0) * 60 * 1000;
  const bufferAfterMs = (opts.bufferAfterMins ?? 0) * 60 * 1000;

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
    const { hour, minute, day } = toIstParts(new Date(t).toISOString());

    if (opts.weeklyWindows) {
      const windows = opts.weeklyWindows[day as 0 | 1 | 2 | 3 | 4 | 5 | 6];
      if (!windows?.length) continue;
      const minuteOfDay = hour * 60 + minute;
      const slotEndMinuteOfDay = minuteOfDay + opts.durationMins;
      const fitsAWindow = windows.some(
        (w) => minuteOfDay >= w.startMin && slotEndMinuteOfDay <= w.endMin,
      );
      if (!fitsAWindow) continue;
    } else {
      if (day === 0 || day === 6) continue; // weekend
      if (hour < workStart || hour >= workEnd) continue;
    }

    const slotEnd = t + durationMs;
    const overlaps = busyRanges.some(
      (b) => t - bufferBeforeMs < b.end && slotEnd + bufferAfterMs > b.start,
    );
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

const DAY_NAME_TO_INDEX: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/** `BookingPolicy.weeklyWindowsJson` is stored with day-name keys
 * (`{"mon":[...], "tue":[...]}`) — human-readable for the settings UI's
 * 7-row weekday editor. Converts to the numeric-day-indexed shape
 * `generateCandidateSlots` needs (matching JS Date#getDay()). Malformed
 * JSON or an unrecognized day name is silently dropped, not thrown —
 * this only ever narrows availability, never widens it past what's
 * genuinely configured. */
export function parseWeeklyWindowsJson(json: string): WeeklyWindows {
  let raw: Record<string, WeeklyWindow[]>;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    return {};
  }
  const out: WeeklyWindows = {};
  for (const [name, windows] of Object.entries(raw)) {
    const idx = DAY_NAME_TO_INDEX[name.trim().toLowerCase()];
    if (idx === undefined || !Array.isArray(windows)) continue;
    out[idx] = windows;
  }
  return out;
}

/** `BookingPolicy.durationOptionsJson` is stored as a plain JSON number
 * array (e.g. `"[15,30,60]"`). Malformed JSON or an empty array falls
 * back to a single 30-minute option rather than throwing or leaving a
 * policy with nothing bookable at all. */
export function parseDurationOptions(json: string): number[] {
  try {
    const arr = JSON.parse(json || "[30]");
    return Array.isArray(arr) && arr.length ? arr : [30];
  } catch {
    return [30];
  }
}

/**
 * Real, connected-calendar-grounded candidate slots for a public booking
 * policy — the exact same conflict-avoidance implementation as
 * getCandidateMeetingSlots above, parameterized by the CEO's configured
 * weekly windows/buffers instead of the AI/manual path's hardcoded
 * weekday-9am-6pm default. Returns [] (not an error) when this account
 * has no Google Calendar connection.
 */
export async function getPublicBookingSlots(
  accountId: string,
  policy: {
    weeklyWindowsJson: string;
    bufferBeforeMins: number;
    bufferAfterMins: number;
    minNoticeHours: number;
    maxAdvanceDays: number;
  },
  opts: { durationMins: number; maxCandidates?: number },
): Promise<MeetingSlotOption[]> {
  const weeklyWindows = parseWeeklyWindowsJson(policy.weeklyWindowsJson);
  const now = new Date();
  const timeMin = new Date(now.getTime() + policy.minNoticeHours * 60 * 60 * 1000);
  const timeMax = new Date(now.getTime() + policy.maxAdvanceDays * 24 * 60 * 60 * 1000);
  if (timeMax <= timeMin) return [];

  const result = await getFreeBusy(accountId, timeMin.toISOString(), timeMax.toISOString());
  if (!result) return [];

  const candidates = generateCandidateSlots(result.busy, {
    timeMinIso: timeMin.toISOString(),
    timeMaxIso: timeMax.toISOString(),
    durationMins: opts.durationMins,
    weeklyWindows,
    bufferBeforeMins: policy.bufferBeforeMins,
    bufferAfterMins: policy.bufferAfterMins,
    maxCandidates: opts.maxCandidates ?? 20,
  });

  return candidates.map((c) => ({ ...c, label: formatSlotForDisplay(c) }));
}
