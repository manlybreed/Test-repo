"use server";

import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { ensureCeoMailAccount, requireOwnedAccount } from "@/lib/mail/account";
import { prisma } from "@/lib/prisma";

async function requireAccount(accountId?: string) {
  await requireCeo();
  const session = await auth();
  const userId = session?.user?.id as string;
  if (accountId) {
    const account = await requireOwnedAccount(accountId, userId);
    return { account, userId };
  }
  const account = await ensureCeoMailAccount(userId);
  if (!account) throw new Error("Configure CEO_MAIL_USER and CEO_MAIL_PASS");
  return { account, userId };
}

/** Lowercase letters/digits with single hyphens between — the same shape
 * every public URL slug convention uses; rejected up front rather than
 * relying only on the DB's unique constraint to catch a bad value. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type WeeklyWindowInput = { startMin: number; endMin: number };
/** Day-name keyed (mon/tue/.../sun) — matches BookingPolicy.weeklyWindowsJson's
 * storage format directly; the settings UI's 7-row weekday editor reads/
 * writes this shape with no conversion. Converting to the numeric-day-
 * indexed shape generateCandidateSlots needs happens in
 * propose-times.ts's parseWeeklyWindowsJson, not here. */
export type WeeklyWindowsInput = Partial<Record<
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
  WeeklyWindowInput[]
>>;

export type BookingPolicySettings = {
  enabled: boolean;
  slug: string;
  title: string;
  description: string;
  weeklyWindows: WeeklyWindowsInput;
  durationOptions: number[];
  bufferBeforeMins: number;
  bufferAfterMins: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
};

function slugify(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "meeting";
}

/** The CEO's current public-booking configuration, or a sensible unsaved
 * default (derived from the mailbox address, disabled) when none exists
 * yet — the settings panel always has something reasonable to show and
 * edit, never a blank/broken form on first visit. */
export async function getBookingPolicyAction(
  accountId?: string,
): Promise<BookingPolicySettings> {
  const { account } = await requireAccount(accountId);
  const row = await prisma.bookingPolicy.findUnique({ where: { accountId: account.id } });
  if (!row) {
    return {
      enabled: false,
      slug: slugify(account.address.split("@")[0] || "meeting"),
      title: "Meeting",
      description: "",
      weeklyWindows: {},
      durationOptions: [30],
      bufferBeforeMins: 0,
      bufferAfterMins: 0,
      minNoticeHours: 24,
      maxAdvanceDays: 30,
    };
  }
  let weeklyWindows: WeeklyWindowsInput = {};
  let durationOptions: number[] = [30];
  try {
    weeklyWindows = JSON.parse(row.weeklyWindowsJson || "{}");
  } catch {
    weeklyWindows = {};
  }
  try {
    durationOptions = JSON.parse(row.durationOptionsJson || "[30]");
  } catch {
    durationOptions = [30];
  }
  return {
    enabled: row.enabled,
    slug: row.slug,
    title: row.title,
    description: row.description || "",
    weeklyWindows,
    durationOptions,
    bufferBeforeMins: row.bufferBeforeMins,
    bufferAfterMins: row.bufferAfterMins,
    minNoticeHours: row.minNoticeHours,
    maxAdvanceDays: row.maxAdvanceDays,
  };
}

/**
 * Upserts the CEO's public-booking policy. Validates the slug shape and
 * that at least one duration is offered before touching the DB; the
 * DB's own unique constraint on `slug` is still the final word (caught
 * below as P2002) in case of a race with another save.
 */
export async function saveBookingPolicyAction(
  input: BookingPolicySettings,
  accountId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { account } = await requireAccount(accountId);

  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: "Link must be lowercase letters, numbers, and hyphens only (e.g. \"akshay-30min\").",
    };
  }
  const durationOptions = Array.from(
    new Set(input.durationOptions.filter((d) => Number.isFinite(d) && d > 0)),
  ).sort((a, b) => a - b);
  if (!durationOptions.length) {
    return { ok: false, error: "Pick at least one meeting duration to offer." };
  }

  const data = {
    enabled: input.enabled,
    slug,
    title: input.title.trim() || "Meeting",
    description: input.description.trim() || null,
    weeklyWindowsJson: JSON.stringify(input.weeklyWindows),
    durationOptionsJson: JSON.stringify(durationOptions),
    bufferBeforeMins: Math.max(0, Math.round(input.bufferBeforeMins)),
    bufferAfterMins: Math.max(0, Math.round(input.bufferAfterMins)),
    minNoticeHours: Math.max(0, Math.round(input.minNoticeHours)),
    maxAdvanceDays: Math.max(1, Math.round(input.maxAdvanceDays)),
  };

  try {
    await prisma.bookingPolicy.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id, ...data },
      update: data,
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "That link is already taken — pick a different one." };
    }
    throw e;
  }
}

/** Live availability check as the CEO types a slug — true if unused, or
 * already owned by this same mailbox (editing its own current slug isn't
 * a conflict with itself). */
export async function checkSlugAvailableAction(
  slug: string,
  accountId?: string,
): Promise<{ available: boolean }> {
  const { account } = await requireAccount(accountId);
  const clean = slug.trim().toLowerCase();
  if (!SLUG_RE.test(clean)) return { available: false };
  const existing = await prisma.bookingPolicy.findUnique({ where: { slug: clean } });
  return { available: !existing || existing.accountId === account.id };
}
