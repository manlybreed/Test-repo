import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { checkAutonomy } from "@/lib/mail/ai/policy";
import {
  hasSmartLabel,
  mergeSmartLabels,
  parseLabelsJson,
  refineSmartLabels,
  SMART_LABELS,
  smartLabelPromptBlock,
  type SmartLabel,
} from "@/lib/mail/ai/smart-labels";

const TriageSchema = z.object({
  priority: z.enum(["P1", "P2", "P3", "P4", "NONE"]),
  labels: z.array(z.string()),
  reason: z.string().optional(),
});

export type TriageResult = z.infer<typeof TriageSchema>;

async function alreadyTriaged(threadId: string): Promise<boolean> {
  const cached = await prisma.mailAiCache.findFirst({
    where: { threadId, kind: "TRIAGE" },
    select: { id: true },
  });
  return Boolean(cached);
}

function triageCorpus(messages: {
  fromAddress: string;
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  listUnsubscribe: string | null;
}[]) {
  const text = messages
    .map(
      (m) =>
        `${m.fromAddress}\n${m.subject}\n${m.snippet || ""}\n${(m.bodyText || "").slice(0, 600)}`,
    )
    .join("\n---\n");
  return {
    text,
    fromAddresses: messages.map((m) => m.fromAddress),
    hasListUnsubscribe: messages.some((m) => Boolean(m.listUnsubscribe)),
  };
}

/** AI-01 + AI-02 — categorize priority + smart labels for one thread. */
export async function triageThread(
  threadId: string,
  opts?: { autoApply?: boolean; confirmed?: boolean; force?: boolean },
): Promise<TriageResult | null> {
  if (!getAnthropic()) return null;

  if (!opts?.force && (await alreadyTriaged(threadId))) {
    const thread = await prisma.mailThread.findUnique({
      where: { id: threadId },
      select: { priority: true, labelsJson: true },
    });
    if (!thread) return null;
    const labels = parseLabelsJson(thread.labelsJson).filter((l) =>
      (SMART_LABELS as readonly string[]).includes(l),
    );
    return {
      priority: (["P1", "P2", "P3", "P4", "NONE"].includes(thread.priority)
        ? thread.priority
        : "NONE") as TriageResult["priority"],
      labels,
      reason: "cached",
    };
  }

  if (opts?.force) {
    await prisma.mailAiCache
      .deleteMany({ where: { threadId, kind: "TRIAGE" } })
      .catch(() => undefined);
  }

  const thread = await prisma.mailThread.findUnique({
    where: { id: threadId },
    include: {
      messages: {
        where: { folder: { role: { in: ["INBOX", "SENT"] } } },
        orderBy: { date: "desc" },
        take: 8,
        select: {
          fromAddress: true,
          subject: true,
          snippet: true,
          bodyText: true,
          listUnsubscribe: true,
          folder: { select: { role: true } },
        },
      },
      account: { include: { autonomy: true } },
    },
  });
  if (!thread) return null;

  // Fall back if conversation has no Inbox/Sent rows yet
  const messages =
    thread.messages.length > 0
      ? thread.messages
      : await prisma.mailMessage.findMany({
          where: { threadId },
          orderBy: { date: "desc" },
          take: 8,
          select: {
            fromAddress: true,
            subject: true,
            snippet: true,
            bodyText: true,
            listUnsubscribe: true,
          },
        });

  const clientHit = await prisma.client.findFirst({
    where: {
      email: {
        in: messages.map((m) => m.fromAddress),
        mode: "insensitive",
      },
    },
  });

  const corpus = triageCorpus(messages);

  const raw = await claudeJson<TriageResult>({
    model: "haiku",
    system: `You triage CEO email for Akshay (BluRidge). Return JSON only:
{priority: P1|P2|P3|P4|NONE, labels: string[], reason?: string}

Priority:
- P1 = urgent client/deadline/blocker today
- P2 = important this week
- P3 = normal work mail
- P4 = low-value / noise / test / newsletter
- NONE = truly unclear

Smart labels — use ONLY these ids, pick ONE primary (second only if clearly true):
${smartLabelPromptBlock()}

Hard rules:
- BANKING for bank/UPI/card e-statements and account alerts (POS e-statement, NEFT/IMPS, balance alerts). Priority P4 unless urgent fraud.
- PM_KUSUM for PM KUSUM / solar-pump / Component A-B-C / KUSUM financing or plant mail (BluRidge core work). May combine with NEEDS_REPLY.
- RECEIPT for merchant invoices/order confirmations only — not bank mail (use BANKING).
- NEWSLETTER for any promo/marketing/digest/unsubscribe/noreply campaign. Priority P4.
- NEVER use NEEDS_REPLY on promotional, newsletter, banking, or automated marketing mail.
- Test subjects/bodies ("test email", "it worked") → priority P4 and label FYI.
- Do not invent labels. Prefer BANKING over RECEIPT for banks; PM_KUSUM for scheme mail; NEWSLETTER over NEEDS_REPLY for bulk mail.`,
    user: fenceMailData({
      subject: thread.subject,
      myAddress: thread.account.address,
      knownClient: clientHit?.name || null,
      messages: messages.map((m) => ({
        from: m.fromAddress,
        subject: m.subject,
        snippet: m.snippet || m.bodyText?.slice(0, 400),
        hasUnsubscribe: Boolean(m.listUnsubscribe),
      })),
    }),
  });

  if (!raw) return null;
  const parsed = TriageSchema.safeParse(raw);
  if (!parsed.success) return null;

  const refined = refineSmartLabels(parsed.data.labels, {
    subject: thread.subject,
    text: corpus.text,
    fromAddresses: corpus.fromAddresses,
    myAddress: thread.account.address,
    hasListUnsubscribe: corpus.hasListUnsubscribe,
  });

  // Keep model priority, but nudge obvious test/noise to P4
  let priority = parsed.data.priority;
  const blob = `${thread.subject}\n${corpus.text}`.toLowerCase();
  if (
    (/\btest(\s+email|\s+mail)?\b/.test(blob) || /\bit worked\b/.test(blob)) &&
    (priority === "P1" || priority === "P2" || priority === "NONE")
  ) {
    priority = "P4";
  }

  const result: TriageResult = {
    priority,
    labels: refined as string[],
    reason: parsed.data.reason,
  };

  if (opts?.autoApply !== false) {
    const auto = thread.account.autonomy;
    const priOk = checkAutonomy("priority", {
      autoPriority: auto?.autoPriority ?? true,
    });
    const labOk = checkAutonomy("label", {
      autoLabel: auto?.autoLabel ?? true,
    });
    if (priOk.allowed || labOk.allowed) {
      const existing = parseLabelsJson(thread.labelsJson);
      await prisma.mailThread.update({
        where: { id: threadId },
        data: {
          ...(priOk.allowed ? { priority: result.priority } : {}),
          ...(labOk.allowed
            ? {
                labelsJson: JSON.stringify(
                  mergeSmartLabels(existing, refined as SmartLabel[]),
                ),
              }
            : {}),
        },
      });
    }

    await prisma.mailAiCache.create({
      data: {
        threadId,
        kind: "TRIAGE",
        payloadJson: JSON.stringify(result),
        model: "claude-haiku-4-5",
      },
    });
  }

  return result;
}

/** Triage newly imported threads only — skips already-cached. */
export async function triageNewThreads(
  threadIds: string[],
  opts?: { max?: number },
): Promise<{ attempted: number; labeled: number }> {
  const max = opts?.max ?? 8;
  const unique = Array.from(new Set(threadIds)).slice(0, max * 2);
  let attempted = 0;
  let labeled = 0;

  for (const id of unique) {
    if (attempted >= max) break;
    if (await alreadyTriaged(id)) continue;
    attempted += 1;
    const r = await triageThread(id).catch(() => null);
    if (r && r.reason !== "cached") labeled += 1;
  }

  return { attempted, labeled };
}

/**
 * Cheap post-hoc fix: re-run deterministic guardrails on threads that already
 * have smart labels (no Claude). Fixes bad RECEIPT/NEWSLETTER from older prompts.
 */
export async function repairSmartLabels(opts: {
  accountId: string;
  limit?: number;
}): Promise<{ checked: number; fixed: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200);
  const threads = await prisma.mailThread.findMany({
    where: {
      accountId: opts.accountId,
      OR: [
        { labelsJson: { contains: '"RECEIPT"' } },
        { labelsJson: { contains: '"BANKING"' } },
        { labelsJson: { contains: '"NEWSLETTER"' } },
        { labelsJson: { contains: '"NEEDS_REPLY"' } },
        // Catch bulk/banking mail wrongly labeled FYI
        {
          AND: [
            { labelsJson: { contains: '"FYI"' } },
            { priority: "P4" },
          ],
        },
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
    select: {
      id: true,
      subject: true,
      labelsJson: true,
      account: { select: { address: true } },
      messages: {
        where: { folder: { role: { in: ["INBOX", "SENT"] } } },
        orderBy: { date: "desc" },
        take: 6,
        select: {
          fromAddress: true,
          subject: true,
          snippet: true,
          bodyText: true,
          listUnsubscribe: true,
        },
      },
    },
  });

  let fixed = 0;
  for (const t of threads) {
    const existing = parseLabelsJson(t.labelsJson);
    const smart = existing.filter((l) =>
      (SMART_LABELS as readonly string[]).includes(l),
    );
    if (!smart.length) continue;

    const corpus = triageCorpus(t.messages);
    const refined = refineSmartLabels(smart, {
      subject: t.subject,
      text: corpus.text,
      fromAddresses: corpus.fromAddresses,
      myAddress: t.account.address,
      hasListUnsubscribe: corpus.hasListUnsubscribe,
    });

    const before = smart.slice().sort().join(",");
    const after = refined.slice().sort().join(",");
    if (before === after) continue;

    await prisma.mailThread.update({
      where: { id: t.id },
      data: {
        labelsJson: JSON.stringify(mergeSmartLabels(existing, refined)),
      },
    });
    // Bust stale triage cache so manual Triage / UI refresh sees the repair
    await prisma.mailAiCache
      .deleteMany({ where: { threadId: t.id, kind: "TRIAGE" } })
      .catch(() => undefined);
    fixed += 1;
  }

  return { checked: threads.length, fixed };
}

/** Backfill smart labels on older mail that was never triaged. */
export async function backfillSmartLabels(opts: {
  accountId: string;
  limit?: number;
}): Promise<{ processed: number; labeled: number; remaining: number }> {
  // Small batches keep each server-action under timeout; UI loops until remaining=0
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 40);

  const candidates = await prisma.mailThread.findMany({
    where: {
      accountId: opts.accountId,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: new Date() } }],
    },
    orderBy: { lastMessageAt: "desc" },
    take: 500,
    select: { id: true, labelsJson: true },
  });

  const cached = await prisma.mailAiCache.findMany({
    where: {
      kind: "TRIAGE",
      threadId: { in: candidates.map((c) => c.id) },
    },
    select: { threadId: true },
  });
  const cachedSet = new Set(cached.map((c) => c.threadId).filter(Boolean));

  const need = candidates.filter((c) => {
    if (cachedSet.has(c.id)) return false;
    return !hasSmartLabel(parseLabelsJson(c.labelsJson));
  });

  let labeled = 0;
  let processed = 0;
  for (const t of need.slice(0, limit)) {
    processed += 1;
    const r = await triageThread(t.id).catch(() => null);
    if (r && r.reason !== "cached") labeled += 1;
  }

  return {
    processed,
    labeled,
    remaining: Math.max(0, need.length - processed),
  };
}

export function parseTriageJson(input: unknown): TriageResult {
  return TriageSchema.parse(input);
}
