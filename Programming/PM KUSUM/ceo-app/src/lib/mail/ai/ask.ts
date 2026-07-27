import { z } from "zod";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { packChunks, retrieveMail, type RetrievedChunk } from "@/lib/mail/ai/retrieve";
import { resolvePersonAddress } from "@/lib/mail/contacts";

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
  /** Model-cited subset — used for the fallback source list. */
  citationRefs: AskCitation[];
  /** Every packed source, so inline [[messageId]] markers in `answer` resolve. */
  sourceRefs: AskCitation[];
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

export type AskTurn = { question: string; answer: string };

/** Bound how much prior conversation we carry forward — enough for real
 * follow-ups ("and when was that sent?") without letting the prompt grow
 * unbounded over a long Ask session. */
const MAX_HISTORY_TURNS = 6;

export async function askMailbox(
  accountId: string,
  question: string,
  history: AskTurn[] = [],
): Promise<AskResult> {
  const recentHistory = history.slice(-MAX_HISTORY_TURNS);

  // Follow-ups ("and when was that sent?", "who else was on it?") carry
  // almost no retrievable keywords on their own — fold the previous turn's
  // question (and its answer, which usually names the actual subject) into
  // the retrieval query so the right messages still surface.
  const priorTurn = recentHistory[recentHistory.length - 1];
  const retrievalQuery = priorTurn
    ? `${priorTurn.question}\n${priorTurn.answer}\n${question}`
    : question;

  const chunks = await retrieveMail({
    accountId,
    query: retrievalQuery,
    limit: 15,
    rerank: true,
  });
  // R3: Sonnet answers from a larger context budget than the Haiku paths.
  const { packed, citations } = packChunks(chunks, 24000);

  const sourceRefs = refsFromChunks(chunks, citations);

  if (!packed) {
    return {
      answer: "I don't find that in your mail.",
      citations: [],
      citationRefs: [],
      sourceRefs: [],
      notFound: true,
    };
  }

  if (!getAnthropic()) {
    return {
      answer: `Found ${chunks.length} related messages. (AI disabled — open the sources to read.)`,
      citations,
      citationRefs: refsFromChunks(chunks, citations),
      sourceRefs,
      notFound: false,
    };
  }

  const transcript = recentHistory
    .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}`)
    .join("\n\n");

  const raw = await claudeJson<AskResult>({
    model: "sonnet",
    system: `Answer only from mail_data. Each block in mail_data starts with its message id in brackets like [abc123].

This is a multi-turn conversation — conversation_so_far (if present) is the prior Q&A in this session. Use it ONLY to resolve what the current question's pronouns/references ("that", "it", "them", "the sender") mean. Never treat conversation_so_far itself as a source of facts — every factual claim must still be grounded in mail_data and cited, exactly as if this were the first question.

Cite inline: immediately after every statement, fact, or list item that a specific message supports, append that message's id wrapped in DOUBLE square brackets, e.g. [[abc123]]. Copy the id exactly from the [id] prefix of the block it came from. If several messages support one item, append several markers. Every list item that names a person/company/thing MUST end with at least one [[id]] marker.

Return JSON {answer, citations: messageId[], notFound: boolean} where answer contains the inline [[id]] markers and citations lists every id you used.
If unsupported by mail_data, set notFound true and answer "I don't find that in your mail."`,
    user: `${fenceMailData(packed)}${
      transcript
        ? `\n\n<conversation_so_far>\n${transcript}\n</conversation_so_far>`
        : ""
    }\n\nQuestion: ${question}`,
  });

  const parsed = AskSchema.safeParse(raw);
  if (!parsed.success) {
    // Model returned prose / unusable JSON — don't crash the Ask dock
    return {
      answer:
        "I couldn't format a grounded answer from mail just now. Try a more specific question, or open the sources.",
      citations,
      citationRefs: refsFromChunks(chunks, citations),
      sourceRefs,
      notFound: false,
    };
  }

  // Keep only inline markers that point at a genuinely packed source.
  const packedSet = new Set(citations);
  const sanitizedAnswer = parsed.data.answer.replace(
    /\[\[([^\]]+)\]\]/g,
    (whole, id: string) => (packedSet.has(id.trim()) ? `[[${id.trim()}]]` : ""),
  );
  const safeCitations = parsed.data.citations.filter((c) => packedSet.has(c));
  return {
    ...parsed.data,
    answer: sanitizedAnswer,
    citations: safeCitations,
    citationRefs: refsFromChunks(chunks, safeCitations.length ? safeCitations : citations),
    sourceRefs,
  };
}

/** AI-16 — resolve the person to an address via the R2 contact index first. */
export async function recallPerson(
  accountId: string,
  person: string,
): Promise<AskResult> {
  const resolved = await resolvePersonAddress(accountId, person).catch(
    () => null,
  );
  const asEmail = resolved || (person.includes("@") ? person : undefined);
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
      sourceRefs: [],
      notFound: true,
    };
  }
  return askMailbox(
    accountId,
    `What did I last discuss with ${person}? Summarize recent threads.`,
  );
}
