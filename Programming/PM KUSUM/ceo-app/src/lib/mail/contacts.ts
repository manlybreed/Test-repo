import { prisma } from "@/lib/prisma";

/**
 * Phase R2 — people/contact index.
 *
 * A per-account aggregate of who is in the mailbox (address, display-name
 * variants, how often they write, last seen, a few recent subjects). Lets
 * "who sent…" / recall resolve a name to an address without scanning every
 * message, and gives `recallPerson` a warm row to answer from.
 */

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function normAddress(address: string | null | undefined): string | null {
  const a = (address || "").trim().toLowerCase();
  return a && a.includes("@") ? a : null;
}

export type ContactRow = {
  address: string;
  displayName: string | null;
  names: string[];
  messageCount: number;
  lastMessageAt: Date | null;
  sampleSubjects: string[];
};

/** Split a free-text person reference into lookup needles. Pure. */
export function personNeedles(query: string): string[] {
  const q = query.trim().toLowerCase();
  const tokens = q
    .split(/[^a-z0-9@.]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return tokens.length ? tokens : q.length >= 2 ? [q] : [];
}

type RankableContact = {
  address: string;
  displayName: string | null;
  namesJson: string;
  messageCount: number;
  lastMessageAt: Date | null;
};

/**
 * Pure ranking of contact rows against needles: more token hits first, then
 * frequency, then recency. Drops rows with no hit. Exported for testing.
 */
export function rankContacts<T extends RankableContact>(
  rows: T[],
  needles: string[],
  limit: number,
): T[] {
  return rows
    .map((r) => {
      const hay = `${r.displayName || ""} ${r.address} ${r.namesJson}`.toLowerCase();
      const hits = needles.filter((t) => hay.includes(t)).length;
      return { r, hits };
    })
    .filter((x) => x.hits > 0)
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        b.r.messageCount - a.r.messageCount ||
        (b.r.lastMessageAt?.getTime() || 0) - (a.r.lastMessageAt?.getTime() || 0),
    )
    .slice(0, limit)
    .map((x) => x.r);
}

/**
 * Fold a freshly-imported message into the contact index. Upserts the sender
 * (primary "who sent" signal, bumps messageCount) and records recipients so
 * "who did I email about X" resolves too — recipients don't bump the count.
 */
export async function upsertContactsFromMessage(input: {
  accountId: string;
  fromAddress: string;
  fromName?: string | null;
  toAddresses?: { address?: string | null; name?: string | null }[];
  subject?: string | null;
  date: Date;
}): Promise<void> {
  const from = normAddress(input.fromAddress);
  const subject = (input.subject || "").trim();

  if (from) {
    await bumpContact({
      accountId: input.accountId,
      address: from,
      name: input.fromName,
      subject,
      date: input.date,
      sender: true,
    });
  }

  for (const to of input.toAddresses || []) {
    const addr = normAddress(to.address);
    if (!addr || addr === from) continue;
    await bumpContact({
      accountId: input.accountId,
      address: addr,
      name: to.name,
      subject: "",
      date: input.date,
      sender: false,
    });
  }
}

async function bumpContact(input: {
  accountId: string;
  address: string;
  name?: string | null;
  subject: string;
  date: Date;
  sender: boolean;
}): Promise<void> {
  const existing = await prisma.mailContact.findUnique({
    where: {
      accountId_address: { accountId: input.accountId, address: input.address },
    },
  });

  const name = (input.name || "").trim() || null;

  if (!existing) {
    await prisma.mailContact.create({
      data: {
        accountId: input.accountId,
        address: input.address,
        displayName: name,
        namesJson: JSON.stringify(name ? [name] : []),
        messageCount: input.sender ? 1 : 0,
        lastMessageAt: input.date,
        sampleSubjectsJson: JSON.stringify(
          input.subject ? [input.subject].slice(0, 5) : [],
        ),
      },
    });
    return;
  }

  const names = parseJsonArray(existing.namesJson);
  if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase())) {
    names.unshift(name);
  }
  const subjects = parseJsonArray(existing.sampleSubjectsJson);
  if (input.subject && !subjects.includes(input.subject)) {
    subjects.unshift(input.subject);
  }
  const newer =
    !existing.lastMessageAt || input.date > existing.lastMessageAt;

  await prisma.mailContact.update({
    where: { id: existing.id },
    data: {
      messageCount: existing.messageCount + (input.sender ? 1 : 0),
      // Prefer the most recent display name we've seen.
      displayName: newer && name ? name : existing.displayName || name,
      namesJson: JSON.stringify(names.slice(0, 8)),
      lastMessageAt: newer ? input.date : existing.lastMessageAt,
      sampleSubjectsJson: JSON.stringify(subjects.slice(0, 5)),
    },
  });
}

/**
 * One-time (idempotent) backfill from existing messages — group by sender,
 * seed count / last-seen / most-recent display name. Live upserts enrich
 * names + subjects going forward. Safe to re-run.
 */
export async function backfillContacts(accountId: string): Promise<number> {
  const rows = await prisma.$executeRawUnsafe(
    `
    INSERT INTO "MailContact"
      (id, "accountId", address, "displayName", "namesJson",
       "messageCount", "lastMessageAt", "sampleSubjectsJson", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      m."accountId",
      lower(m."fromAddress"),
      (array_agg(m."fromName" ORDER BY m.date DESC)
         FILTER (WHERE m."fromName" IS NOT NULL AND m."fromName" <> ''))[1],
      '[]',
      count(*)::int,
      max(m.date),
      '[]',
      now(), now()
    FROM "MailMessage" m
    WHERE m."accountId" = $1
      AND m."fromAddress" <> ''
      AND position('@' in m."fromAddress") > 0
    GROUP BY m."accountId", lower(m."fromAddress")
    ON CONFLICT ("accountId", address) DO UPDATE SET
      "messageCount"  = EXCLUDED."messageCount",
      "lastMessageAt" = EXCLUDED."lastMessageAt",
      "displayName"   = COALESCE("MailContact"."displayName", EXCLUDED."displayName");
    `,
    accountId,
  );
  return typeof rows === "number" ? rows : 0;
}

/**
 * Fuzzy person lookup: match query name tokens / email fragments against the
 * contact index. Returns best correspondents first (recent + frequent).
 * Lazily backfills the index the first time it's empty for the account.
 */
export async function findContacts(
  accountId: string,
  query: string,
  limit = 5,
): Promise<ContactRow[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const count = await prisma.mailContact.count({ where: { accountId } });
  if (count === 0) {
    await backfillContacts(accountId).catch(() => 0);
  }

  const needles = personNeedles(q);
  if (!needles.length) return [];

  const rows = await prisma.mailContact.findMany({
    where: {
      accountId,
      OR: needles.flatMap((t) => [
        { address: { contains: t, mode: "insensitive" as const } },
        { displayName: { contains: t, mode: "insensitive" as const } },
        { namesJson: { contains: t, mode: "insensitive" as const } },
      ]),
    },
    orderBy: [{ messageCount: "desc" }, { lastMessageAt: "desc" }],
    take: Math.max(limit * 3, 15),
  });

  return rankContacts(rows, needles, limit).map((r) => ({
    address: r.address,
    displayName: r.displayName,
    names: parseJsonArray(r.namesJson),
    messageCount: r.messageCount,
    lastMessageAt: r.lastMessageAt,
    sampleSubjects: parseJsonArray(r.sampleSubjectsJson),
  }));
}

/** Resolve a free-text person reference to the single best address, if any. */
export async function resolvePersonAddress(
  accountId: string,
  person: string,
): Promise<string | null> {
  if (person.includes("@")) return person.trim().toLowerCase();
  const [top] = await findContacts(accountId, person, 1);
  return top?.address ?? null;
}
