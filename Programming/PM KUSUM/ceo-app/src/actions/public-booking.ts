"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createMeetingEvent } from "@/lib/calendar/google";
import {
  getPublicBookingSlots,
  parseDurationOptions,
  type MeetingSlotOption,
} from "@/lib/calendar/propose-times";

/**
 * No `requireCeoAction`/auth import anywhere in this file — a visitor
 * booking through a public link is never signed in. This file never
 * calls assertAutonomy or createMeetingAction: their `confirmed` flag
 * means "a real human just clicked a real button in our own UI," and
 * there is no such human here. Everything below is its own, separate
 * validation chain, not a bypass of that gate.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS_PER_DAY = 20;
const NOT_AVAILABLE = "This booking link isn't available.";

export type PublicBookingInfo =
  | { found: false }
  | {
      found: true;
      title: string;
      description: string | null;
      durationOptions: number[];
      slots: MeetingSlotOption[];
    };

/**
 * Same {found:false} for a slug that doesn't exist and one that exists
 * but is currently disabled — a visitor can never tell the two apart.
 * `durationMins` lets the visitor-facing flow refetch slots after
 * picking a duration; defaults to the policy's first configured option.
 */
export async function getPublicBookingSlotsAction(
  slug: string,
  durationMins?: number,
): Promise<PublicBookingInfo> {
  const policy = await prisma.bookingPolicy.findUnique({
    where: { slug: slug.trim().toLowerCase() },
  });
  if (!policy || !policy.enabled) return { found: false };

  const durationOptions = parseDurationOptions(policy.durationOptionsJson);
  const duration =
    durationMins && durationOptions.includes(durationMins) ? durationMins : durationOptions[0];

  const slots = await getPublicBookingSlots(policy.accountId, policy, {
    durationMins: duration,
    maxCandidates: 40,
  });

  return {
    found: true,
    title: policy.title,
    description: policy.description,
    durationOptions,
    slots,
  };
}

/** True once this IP has made more than MAX_ATTEMPTS_PER_DAY booking
 * attempts today — a lightweight abuse guard, not an anti-bot system. */
async function isRateLimited(): Promise<boolean> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const row = await prisma.publicBookingAttempt.upsert({
    where: { ip_day: { ip, day } },
    create: { ip, day },
    update: { count: { increment: 1 } },
  });
  return row.count > MAX_ATTEMPTS_PER_DAY;
}

export async function createPublicBookingAction(input: {
  slug: string;
  startIso: string;
  endIso: string;
  visitorName: string;
  visitorEmail: string;
  note?: string;
}): Promise<
  { ok: true; htmlLink: string; meetLink: string | null } | { ok: false; reason: string }
> {
  const slug = input.slug.trim().toLowerCase();
  const policy = await prisma.bookingPolicy.findUnique({ where: { slug } });
  if (!policy || !policy.enabled) {
    return { ok: false, reason: NOT_AVAILABLE };
  }

  const visitorName = input.visitorName.trim();
  const visitorEmail = input.visitorEmail.trim();
  if (!visitorName || !EMAIL_RE.test(visitorEmail)) {
    return { ok: false, reason: "Enter your name and a valid email address." };
  }

  const start = new Date(input.startIso);
  const end = new Date(input.endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return { ok: false, reason: "That time slot looks invalid — please pick again." };
  }
  const durationMins = Math.round((end.getTime() - start.getTime()) / 60000);
  const durationOptions = parseDurationOptions(policy.durationOptionsJson);
  if (!durationOptions.includes(durationMins)) {
    return { ok: false, reason: "That meeting length isn't offered on this link." };
  }

  if (await isRateLimited()) {
    return {
      ok: false,
      reason: "Too many booking attempts from this network today — please try again tomorrow.",
    };
  }

  // Re-derive real open slots right now — weekly windows, buffers, and a
  // fresh free/busy check all in one call — rather than trusting the
  // client's chosen time. This also closes the race between two visitors
  // booking the same slot: it reflects the calendar as of *this* request,
  // not whatever it looked like when the visitor loaded the page.
  const freshSlots = await getPublicBookingSlots(policy.accountId, policy, {
    durationMins,
    maxCandidates: 500,
  });
  const stillOpen = freshSlots.some(
    (s) => s.startIso === input.startIso && s.endIso === input.endIso,
  );
  if (!stillOpen) {
    return { ok: false, reason: "That slot was just taken — please pick another time." };
  }

  const noteLine = input.note?.trim() ? `Note from ${visitorName}: ${input.note.trim()}` : null;
  const description = [
    policy.description,
    `Booked by ${visitorName} (${visitorEmail}) via public booking link.`,
    noteLine,
  ]
    .filter(Boolean)
    .join("\n\n");

  const created = await createMeetingEvent(policy.accountId, {
    title: policy.title,
    description,
    startIso: input.startIso,
    endIso: input.endIso,
    attendeeEmails: [visitorEmail],
  });
  if (!created) {
    return { ok: false, reason: "This calendar is temporarily unavailable — please try again shortly." };
  }

  return { ok: true, htmlLink: created.htmlLink, meetLink: created.meetLink };
}
