import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { claudeJson, fenceMailData, getAnthropic } from "@/lib/mail/ai/claude";

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

    return prisma.mailAttachment.update({
      where: { id: attachmentId },
      data: {
        extractedText: text.slice(0, 100_000),
        extractStatus: "DONE",
      },
    });
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
  if (!fresh?.extractedText) {
    return { summary: "No extractable text.", attachmentId };
  }
  if (!getAnthropic()) {
    return {
      summary: fresh.extractedText.slice(0, 500),
      attachmentId,
    };
  }
  const raw = await claudeJson<{ summary: string }>({
    model: "sonnet",
    system: `Summarize the attachment. Return JSON {summary}. Cite that it comes from attachment ${attachmentId}.`,
    user: fenceMailData(fresh.extractedText.slice(0, 12000)),
  });
  return { summary: raw?.summary || "", attachmentId };
}
