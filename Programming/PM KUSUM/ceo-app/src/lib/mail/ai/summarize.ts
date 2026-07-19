import { z } from "zod";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { packChunks, retrieveMail } from "@/lib/mail/ai/retrieve";
import { prisma } from "@/lib/prisma";

const SummarySchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  citations: z.array(z.string()).default([]),
});

export type ThreadSummary = z.infer<typeof SummarySchema>;

/** AI-03 */
export async function summarizeThread(
  accountId: string,
  threadId: string,
): Promise<ThreadSummary | null> {
  if (!getAnthropic()) return null;
  const chunks = await retrieveMail({ accountId, query: "", threadId });
  const { packed, citations } = packChunks(chunks);
  if (!packed) {
    return {
      summary: "No messages in thread.",
      decisions: [],
      openQuestions: [],
      citations: [],
    };
  }

  const raw = await claudeJson<ThreadSummary>({
    model: "sonnet",
    system: `Summarize the email thread. Return JSON {summary, decisions[], openQuestions[], citations[]}.
citations must be messageId values from mail_data only.`,
    user: fenceMailData(packed),
  });
  if (!raw) return null;
  const parsed = SummarySchema.safeParse({
    ...raw,
    citations: (raw.citations || []).filter((c) => citations.includes(c)),
  });
  if (!parsed.success) return null;

  await prisma.mailAiCache.create({
    data: {
      threadId,
      kind: "SUMMARY",
      payloadJson: JSON.stringify(parsed.data),
      model: "claude-sonnet-4-6",
    },
  });
  return parsed.data;
}
