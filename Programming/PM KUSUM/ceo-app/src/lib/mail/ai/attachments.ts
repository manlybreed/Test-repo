import fs from "fs/promises";
import type { MailAttachment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  claudeJson,
  claudeJsonWithDocument,
  fenceMailData,
  getAnthropic,
} from "@/lib/mail/ai/claude";
import { rechunkMessage } from "@/lib/mail/chunking";

/** Below this many non-whitespace characters, treat pdf-parse's "success" as
 * effectively nothing — a scanned/photographed document with no text layer
 * commonly yields a handful of stray characters rather than throwing. */
const MIN_USABLE_EXTRACTED_CHARS = 30;

/** Stay comfortably under Anthropic's per-request size limits (base64
 * inflates the raw file by ~33%, plus the rest of the message). */
const VISION_MAX_FILE_BYTES = 20 * 1024 * 1024;

function visionMediaType(
  att: Pick<MailAttachment, "filename" | "contentType">,
):
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"
  | null {
  const ct = (att.contentType || "").toLowerCase();
  const name = att.filename.toLowerCase();
  if (ct.includes("pdf") || name.endsWith(".pdf")) return "application/pdf";
  if (ct.includes("png") || name.endsWith(".png")) return "image/png";
  if (ct.includes("gif") || name.endsWith(".gif")) return "image/gif";
  if (ct.includes("webp") || name.endsWith(".webp")) return "image/webp";
  if (
    ct.includes("jpeg") ||
    ct.includes("jpg") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg")
  ) {
    return "image/jpeg";
  }
  return null;
}

/** Read a scanned/photographed attachment directly via Claude's vision —
 * used when pdf-parse's text-layer extraction found nothing (or next to
 * nothing) to work with, and for image attachments, which never go through
 * text extraction at all. */
async function summarizeAttachmentByVision(
  att: MailAttachment,
): Promise<string | null> {
  if (!att.storagePath || !getAnthropic()) return null;
  const mediaType = visionMediaType(att);
  if (!mediaType) return null;

  try {
    const stat = await fs.stat(att.storagePath);
    if (stat.size > VISION_MAX_FILE_BYTES) return null;
    const buf = await fs.readFile(att.storagePath);
    const raw = await claudeJsonWithDocument<{ summary: string }>({
      model: "sonnet",
      system:
        "You are reading a scanned or photographed email attachment that " +
        "has no machine-readable text layer, so read it visually. Return " +
        "JSON {summary}: a concise summary of what the document is and its " +
        "key readable details (names, ID/certificate numbers, dates, " +
        "amounts). If it's unreadable, blank, or not a document, say so " +
        "plainly instead of guessing.",
      instruction: `Summarize this attachment (filename: ${att.filename}).`,
      documentBase64: buf.toString("base64"),
      mediaType,
    });
    return raw?.summary?.trim() || null;
  } catch {
    return null;
  }
}

/** AI-13: extract text from PDF/DOCX/text attachments. */
export async function extractAttachmentText(attachmentId: string) {
  const att = await prisma.mailAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!att?.storagePath) {
    return prisma.mailAttachment.update({
      where: { id: attachmentId },
      data: { extractStatus: "SKIPPED" },
    });
  }

  try {
    const buf = await fs.readFile(att.storagePath);
    const ct = (att.contentType || "").toLowerCase();
    let text = "";

    if (ct.includes("text/") || att.filename.endsWith(".txt")) {
      text = buf.toString("utf8");
    } else if (ct.includes("pdf") || att.filename.endsWith(".pdf")) {
      const pdfParse = (await import("pdf-parse")).default as (
        b: Buffer,
      ) => Promise<{ text: string }>;
      const parsed = await pdfParse(buf);
      text = parsed.text || "";
    } else if (
      ct.includes("word") ||
      att.filename.endsWith(".docx") ||
      ct.includes("officedocument")
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || "";
    } else {
      return prisma.mailAttachment.update({
        where: { id: attachmentId },
        data: { extractStatus: "SKIPPED" },
      });
    }

    const updated = await prisma.mailAttachment.update({
      where: { id: attachmentId },
      data: {
        extractedText: text.slice(0, 100_000),
        extractStatus: "DONE",
      },
    });
    // Phase R3: fold the freshly-extracted attachment text into the chunk index.
    await rechunkMessage(updated.messageId).catch(() => undefined);
    return updated;
  } catch {
    return prisma.mailAttachment.update({
      where: { id: attachmentId },
      data: { extractStatus: "FAILED" },
    });
  }
}

/** After sync: extract text for pending PDF/DOCX/txt (capped). AI-13. */
export async function processPendingAttachments(
  accountId: string,
  limit = 12,
): Promise<number> {
  const pending = await prisma.mailAttachment.findMany({
    where: {
      extractStatus: "PENDING",
      message: { accountId },
    },
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true },
  });
  let done = 0;
  for (const row of pending) {
    await extractAttachmentText(row.id);
    done += 1;
  }
  return done;
}

export async function summarizeAttachment(attachmentId: string) {
  const att = await prisma.mailAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!att) return null;
  if (!att.extractedText && att.extractStatus === "PENDING") {
    await extractAttachmentText(attachmentId);
  }
  const fresh = await prisma.mailAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!fresh) return null;

  const usableText =
    (fresh.extractedText?.trim().length ?? 0) >= MIN_USABLE_EXTRACTED_CHARS;

  if (usableText) {
    if (!getAnthropic()) {
      return {
        summary: fresh.extractedText!.slice(0, 500),
        attachmentId,
      };
    }
    const raw = await claudeJson<{ summary: string }>({
      model: "sonnet",
      system: `Summarize the attachment. Return JSON {summary}. Cite that it comes from attachment ${attachmentId}.`,
      user: fenceMailData(fresh.extractedText!.slice(0, 12000)),
    });
    return { summary: raw?.summary || "", attachmentId };
  }

  // pdf-parse only reads a PDF's embedded text layer — a scanned or
  // photographed document (very common for KYC PDFs: Aadhar/PAN cards, net
  // worth certificates, ID photos) has none, so extraction "succeeds" with
  // a handful of stray characters rather than failing outright. Image
  // attachments never go through text extraction at all. Either way, fall
  // back to Claude reading the file directly.
  const visionSummary = await summarizeAttachmentByVision(fresh);
  if (visionSummary) return { summary: visionSummary, attachmentId };

  return { summary: "No extractable text.", attachmentId };
}
