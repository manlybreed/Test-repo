import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";
import { packChunks, retrieveMail } from "@/lib/mail/ai/retrieve";
import { DEFAULT_DRAFT_TONE } from "@/lib/mail/ai/draft-presets";
import { styleInPrompt } from "@/lib/mail/ai/style";

export {
  DEFAULT_DRAFT_TONE,
  DRAFT_REFINE_PRESETS,
  type DraftRefinePresetId,
} from "@/lib/mail/ai/draft-presets";

const DraftSchema = z.object({
  html: z.string(),
  subject: z.string().optional(),
});

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

  const raw = await claudeJson<{ html: string; subject?: string }>({
    model: "sonnet",
    system: `Draft a new HTML email (not a reply). Body only, no outer html/body tags. Return JSON {html, subject}.
Ground any relationship facts only in mail_data / known client. Do not invent commitments, fees, or dates.
Leave a <!--SIGNATURE--> marker where the signature should go.
Default voice: ${DEFAULT_DRAFT_TONE}
Style hints: ${styleInPrompt(account?.styleJson) || "professional concise"}`,
    user: `${fenceMailData({
      knownClient: clientHit
        ? { name: clientHit.name, email: clientHit.email || primaryTo }
        : null,
      recipients: opts.to,
      suggestedSubject: opts.subject || null,
      priorMail: packed || null,
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
