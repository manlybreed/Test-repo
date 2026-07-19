import { z } from "zod";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { packChunks, retrieveMail, type RetrievedChunk } from "@/lib/mail/ai/retrieve";

const AskSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()).default([]),
  notFound: z.boolean().default(false),
});

export type AskCitation = {
  messageId: string;
  threadId: string;
  subject: string;
};

export type AskResult = z.infer<typeof AskSchema> & {
  citationRefs: AskCitation[];
};

function refsFromChunks(chunks: RetrievedChunk[], ids: string[]): AskCitation[] {
  const byId = new Map(chunks.map((c) => [c.messageId, c]));
  const out: AskCitation[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (c) {
      out.push({
        messageId: c.messageId,
        threadId: c.threadId,
        subject: c.subject,
      });
    }
  }
  return out;
}

/** AI-05 search rewrite helper + AI-06 Q&A */
export async function searchMail(
  accountId: string,
  query: string,
  limit = 20,
) {
  return retrieveMail({ accountId, query, limit });
}

export async function askMailbox(
  accountId: string,
  question: string,
): Promise<AskResult> {
  const chunks = await retrieveMail({ accountId, query: question, limit: 15 });
  const { packed, citations } = packChunks(chunks);

  if (!packed) {
    return {
      answer: "I don't find that in your mail.",
      citations: [],
      citationRefs: [],
      notFound: true,
    };
  }

  if (!getAnthropic()) {
    return {
      answer: `Found ${chunks.length} related messages. (AI disabled — open citations to read.)`,
      citations,
      citationRefs: refsFromChunks(chunks, citations),
      notFound: false,
    };
  }

  const raw = await claudeJson<AskResult>({
    model: "sonnet",
    system: `Answer only from mail_data. Return JSON {answer, citations: messageId[], notFound: boolean}.
If unsupported by mail_data, set notFound true and answer "I don't find that in your mail."`,
    user: `${fenceMailData(packed)}\n\nQuestion: ${question}`,
  });

  const parsed = AskSchema.safeParse(raw);
  if (!parsed.success) {
    // Model returned prose / unusable JSON — don't crash the Ask dock
    return {
      answer:
        "I couldn't format a grounded answer from mail just now. Try a more specific question, or open search results.",
      citations,
      citationRefs: refsFromChunks(chunks, citations),
      notFound: false,
    };
  }

  const safeCitations = parsed.data.citations.filter((c) => citations.includes(c));
  return {
    ...parsed.data,
    citations: safeCitations,
    citationRefs: refsFromChunks(chunks, safeCitations.length ? safeCitations : citations),
  };
}

/** AI-16 */
export async function recallPerson(
  accountId: string,
  person: string,
): Promise<AskResult> {
  const asEmail = person.includes("@") ? person : undefined;
  const chunks = await retrieveMail({
    accountId,
    query: person,
    personEmail: asEmail,
    limit: 20,
  });
  if (!chunks.length) {
    return {
      answer: `I don't find recent discussions with ${person} in your mail.`,
      citations: [],
      citationRefs: [],
      notFound: true,
    };
  }
  return askMailbox(
    accountId,
    `What did I last discuss with ${person}? Summarize recent threads.`,
  );
}
