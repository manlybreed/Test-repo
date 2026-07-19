import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { packChunks, retrieveMail } from "@/lib/mail/ai/retrieve";
import { assertAutonomy } from "@/lib/mail/ai/policy";

const CommitmentSchema = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      dueAt: z.string().nullable().optional(),
      priority: z.enum(["P1", "P2", "P3", "P4"]).optional(),
      note: z.string().optional(),
    }),
  ),
});

export type CommitmentProposal = z.infer<typeof CommitmentSchema>;

/** AI-10 extract (does not create Task until accept). */
export async function extractCommitments(
  accountId: string,
  threadId: string,
): Promise<CommitmentProposal | null> {
  if (!getAnthropic()) return null;
  const chunks = await retrieveMail({ accountId, query: "", threadId });
  const { packed } = packChunks(chunks);
  const raw = await claudeJson<CommitmentProposal>({
    model: "sonnet",
    system: `Extract action items/commitments for the CEO. Return JSON {items:[{title, dueAt?: ISO date|null, priority?, note?}]}.`,
    user: fenceMailData(packed),
  });
  const parsed = CommitmentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function acceptCommitmentAsTask(opts: {
  userId: string;
  threadId: string;
  messageId?: string;
  title: string;
  dueAt?: string | null;
  priority?: string;
  confirmed: boolean;
}) {
  assertAutonomy("create_task", { confirmed: opts.confirmed });

  return prisma.task.create({
    data: {
      userId: opts.userId,
      title: opts.title,
      mailThreadId: opts.threadId,
      mailMessageId: opts.messageId || null,
      dueAt: opts.dueAt ? new Date(opts.dueAt) : null,
      priority: opts.priority || null,
      description: "Created from CEO Mail",
    },
  });
}
