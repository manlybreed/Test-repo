import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { packChunks, retrieveMail } from "@/lib/mail/ai/retrieve";
import { DEFAULT_DRAFT_TONE } from "@/lib/mail/ai/draft-presets";
import { styleInPrompt } from "@/lib/mail/ai/style";
import { findContacts, resolvePersonAddress } from "@/lib/mail/contacts";

export {
  DEFAULT_DRAFT_TONE,
  DRAFT_REFINE_PRESETS,
  type DraftRefinePresetId,
} from "@/lib/mail/ai/draft-presets";

const DraftSchema = z.object({
  html: z.string(),
  subject: z.string().optional(),
});

// The only regex left in this file: a plain shape check on the email
// address Claude returns below. That string is about to become a literal
// SMTP recipient, so it needs validating as one regardless of how it was
// extracted — this is a format check, not a parsing/understanding step.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * AI Draft's brief box is the only place a fresh-compose instruction like
 * "write a mail to yogesh ji on abc@gmail.com" gets typed — but the To
 * field it's supposed to control was never wired to it, so the recipient
 * silently stayed blank (or whatever was already typed) no matter what the
 * instruction said.
 *
 * This used to pattern-match "a Capitalized word after to/for", which
 * doesn't generalize: real instructions use lowercase names ("yogesh
 * ji"), honorifics, and orderings a fixed pattern can't anticipate (e.g.
 * "regarding the cricket screening to Ram. xyz@gmail.com" — a period
 * right after the name, no space before the email). "Who is this email
 * for" is a genuine language-understanding task, so it goes through
 * Claude instead of a regex trying to approximate understanding.
 */
export async function resolveDraftRecipients(
  accountId: string,
  intent: string,
): Promise<{ to: string[]; knownName: string | null }> {
  if (!getAnthropic()) return { to: [], knownName: null };

  const raw = await claudeJson<{
    recipientEmail: string | null;
    recipientName: string | null;
  }>({
    model: "haiku",
    system: `Read this instruction describing a new email to draft, and identify who it is being sent to. Return JSON {recipientEmail, recipientName}.
- recipientEmail: the exact email address given for the recipient, copied exactly — null if none is given. Never invent or guess one.
- recipientName: the recipient's name, if the instruction names them — regardless of capitalization, and with any honorific (ji, sir, madam, etc.) stripped off. Only the person this email is being SENT TO, not someone merely mentioned as the topic/subject of the email. null if the instruction doesn't name the recipient.
Respond with null for a field rather than guessing.`,
    user: intent,
    maxTokens: 150,
  });

  const emailCandidate = raw?.recipientEmail?.trim().toLowerCase() || null;
  const email =
    emailCandidate && EMAIL_SHAPE_RE.test(emailCandidate) ? emailCandidate : null;
  const nameFromModel = raw?.recipientName?.trim() || null;

  if (email) {
    // Cross-check against the contact index for a real display name, so
    // the draft addresses the recipient correctly instead of guessing.
    const [hit] = await findContacts(accountId, email, 1).catch(() => []);
    return { to: [email], knownName: hit?.displayName || nameFromModel };
  }

  if (!nameFromModel) return { to: [], knownName: null };
  const address = await resolvePersonAddress(accountId, nameFromModel).catch(
    () => null,
  );
  return { to: address ? [address] : [], knownName: nameFromModel };
}

/** AI-07 grounded draft; AI-09 uses account.styleJson */
export async function draftReply(opts: {
  accountId: string;
  threadId: string;
  intent?: string;
  tone?: string;
}): Promise<{ html: string; subject?: string; tone: string } | null> {
  if (!getAnthropic()) return null;

  const tone = opts.tone?.trim() || DEFAULT_DRAFT_TONE;
  const account = await prisma.mailAccount.findUnique({
    where: { id: opts.accountId },
    include: { signatures: { where: { isDefault: true }, take: 1 } },
  });
  const chunks = await retrieveMail({
    accountId: opts.accountId,
    query: "",
    threadId: opts.threadId,
  });
  const { packed } = packChunks(chunks);
  const sig = account?.signatures[0]?.htmlBody || "";

  const raw = await claudeJson<{ html: string; subject?: string }>({
    model: "sonnet",
    system: `Draft an HTML email reply (body only, no outer html/body tags). Return JSON {html, subject?}.
Ground facts only in mail_data. Do not invent commitments. Leave a <!--SIGNATURE--> marker where signature should go.
Default voice: ${DEFAULT_DRAFT_TONE}
Style hints: ${styleInPrompt(account?.styleJson) || "professional concise"}`,
    user: `${fenceMailData(packed)}\n\nIntent: ${opts.intent || "reply appropriately"}\nTone: ${tone}`,
  });

  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) return null;

  const html = parsed.data.html.includes("<!--SIGNATURE-->")
    ? parsed.data.html.replace("<!--SIGNATURE-->", sig)
    : `${parsed.data.html}\n${sig}`;

  return { html, subject: parsed.data.subject, tone };
}

/** Fresh email (no reply thread) — grounded in recipient history when available. */
export async function draftNewMail(opts: {
  accountId: string;
  to: string[];
  intent: string;
  subject?: string;
  tone?: string;
  /** A recipient name the user's own instruction named explicitly (e.g.
   * "...belonging to Baneshwari Royal") — a fallback for recipientName
   * when no contact/client record confirms a name for the address. Unlike
   * topicReference, this comes from the user's own words about *this*
   * email, not from unrelated retrieved correspondence, so it's trusted. */
  recipientNameHint?: string;
}): Promise<{ html: string; subject?: string; tone: string } | null> {
  if (!getAnthropic()) return null;
  const intent = opts.intent.trim();
  if (!intent) throw new Error("Describe what the email should say");

  const tone = opts.tone?.trim() || DEFAULT_DRAFT_TONE;
  const account = await prisma.mailAccount.findUnique({
    where: { id: opts.accountId },
    include: { signatures: { where: { isDefault: true }, take: 1 } },
  });
  const sig = account?.signatures[0]?.htmlBody || "";
  const primaryTo = opts.to[0]?.toLowerCase() || "";

  const clientHit = primaryTo
    ? await prisma.client.findFirst({
        where: { email: { equals: primaryTo, mode: "insensitive" } },
      })
    : null;
  // Business clients aren't the only "known" recipients — most personal
  // correspondence resolves through the contact index instead.
  const [contactHit] = primaryTo
    ? await findContacts(opts.accountId, primaryTo, 1).catch(() => [])
    : [];

  const chunks = primaryTo
    ? await retrieveMail({
        accountId: opts.accountId,
        query: intent,
        personEmail: primaryTo,
        limit: 10,
      })
    : await retrieveMail({
        accountId: opts.accountId,
        query: intent,
        limit: 8,
      });
  const { packed } = packChunks(chunks);

  // A single authoritative field for "who am I greeting", resolved before
  // the prompt is built — the model's only job is to read this one value,
  // not reconcile three separate fields (knownClient/knownContact/intent
  // text) into an inference of whether a name is "allowed". Ambiguity in
  // that reconciliation is exactly what let the model fall back to
  // pattern-matching a name out of unrelated retrieved mail instead.
  const recipientName =
    contactHit?.displayName ||
    clientHit?.name ||
    opts.recipientNameHint?.trim() ||
    null;

  const raw = await claudeJson<{ html: string; subject?: string }>({
    model: "sonnet",
    system: `Draft a new HTML email (not a reply). Body only, no outer html/body tags. Return JSON {html, subject}.

Recipient identity — resolve this first, before writing anything: mail_data.recipientName is the ONLY source of truth for how to greet the recipient.
- If recipientName is a string, greet them by exactly that name.
- If recipientName is null, you have NO identity for this recipient. The greeting must be "Hi," with no name attached — this is a hard requirement, not a style preference, regardless of what names appear anywhere else in mail_data.

mail_data.topicReference is unrelated background material retrieved by keyword match for tone/topic/fact grounding only — it is other people's past correspondence, not a conversation with this email's recipient. It will often contain its own greetings and names ("Dear X," from some unrelated thread); none of those identify who you are writing to now, and recipientName above always overrides anything you see in topicReference.

Ground any factual claims (dates, figures, commitments) only in topicReference or knownClient — never invent them.
Leave a <!--SIGNATURE--> marker where the signature should go.
Default voice: ${DEFAULT_DRAFT_TONE}
Style hints: ${styleInPrompt(account?.styleJson) || "professional concise"}`,
    user: `${fenceMailData({
      recipientName,
      knownClient: clientHit
        ? { name: clientHit.name, email: clientHit.email || primaryTo }
        : null,
      recipients: opts.to,
      suggestedSubject: opts.subject || null,
      topicReference: packed || null,
    })}\n\nWrite about: ${intent}\nTone: ${tone}`,
  });

  const parsed = DraftSchema.safeParse(raw);
  if (!parsed.success) return null;

  const html = parsed.data.html.includes("<!--SIGNATURE-->")
    ? parsed.data.html.replace("<!--SIGNATURE-->", sig)
    : `${parsed.data.html}\n${sig}`;

  return {
    html,
    subject: parsed.data.subject || opts.subject,
    tone,
  };
}

export type RewriteMode =
  | "shorten"
  | "soften"
  | "formalize"
  | "translate"
  | "refine";

/** AI-08 */
export async function rewriteDraft(opts: {
  html: string;
  mode: RewriteMode;
  targetLang?: string;
  instruction?: string;
}): Promise<string | null> {
  if (!opts.html.trim()) throw new Error("Empty draft");
  if (!getAnthropic()) return null;

  const instruction =
    opts.instruction?.trim() ||
    (opts.mode === "refine"
      ? "Improve clarity while keeping the same meaning."
      : `Apply mode=${opts.mode}`);

  const raw = await claudeJson<{ html: string }>({
    model: "haiku",
    system: `Rewrite the HTML email draft. Return JSON {html}.
Preserve links and signature blocks if present. Do not invent new facts or commitments.
Mode=${opts.mode}${opts.targetLang ? ` targetLang=${opts.targetLang}` : ""}
Instruction: ${instruction}
Keep the same overall voice unless the instruction asks to change tone.`,
    user: opts.html,
  });
  return raw?.html || null;
}

export async function refineDraftWithInstruction(opts: {
  html: string;
  instruction: string;
}): Promise<string | null> {
  return rewriteDraft({
    html: opts.html,
    mode: "refine",
    instruction: opts.instruction,
  });
}

/** AI-14 */
export async function autocompleteDraft(opts: {
  prefix: string;
  threadSnippet?: string;
}): Promise<string | null> {
  if (!getAnthropic()) return null;
  if (opts.prefix.trim().length < 8) return null;

  const raw = await claudeJson<{ suggestion: string }>({
    model: "haiku",
    maxTokens: 120,
    system: `Suggest a short next-sentence completion for an email. Return JSON {suggestion} with ONLY the completion text (no quotes).`,
    user: `Thread context: ${opts.threadSnippet || ""}\n\nSo far:\n${opts.prefix.slice(-800)}`,
  });
  return raw?.suggestion || null;
}

/** AI-15 */
export async function multilingualDraft(opts: {
  accountId: string;
  threadId: string;
  language: string;
  intent?: string;
}) {
  return draftReply({
    accountId: opts.accountId,
    threadId: opts.threadId,
    intent: `${opts.intent || "reply"} in ${opts.language}`,
    tone: "clear",
  });
}
