import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { GST_ENTITIES } from "@/lib/gst-entities";
import { prepareUploadFile, uploadErrorResponse } from "@/lib/upload";
import { reconcileExpenseGstFlags } from "@/lib/expense-gst-check";

const CATEGORY_LIST = EXPENSE_CATEGORIES.map((c) => `${c.id}: ${c.label}`).join("\n");

async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    // Same import path as doc-content — avoids pdf-parse test-file side effects
    const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    const parsed = await pdfParse(buffer);
    return (parsed.text || "").trim();
  } catch (err) {
    console.warn("[/api/expenses/extract] pdf text extract failed", err);
    return "";
  }
}

function applyGstCheck(
  extractedData: Record<string, string | number | boolean | null>,
  documentText?: string,
): Record<string, string | number | boolean | null> {
  const reconciled = reconcileExpenseGstFlags({
    billedTo: (extractedData.billedTo as string) || null,
    ourGstMentioned:
      typeof extractedData.ourGstMentioned === "boolean"
        ? extractedData.ourGstMentioned
        : null,
    billedGstin: (extractedData.billedGstin as string) || null,
    gstEntity: (extractedData.gstEntity as string) || null,
    description: (extractedData.description as string) || null,
    vendor: (extractedData.vendor as string) || null,
    rawExtract: JSON.stringify(extractedData),
    documentText: documentText || null,
  });

  return {
    ...extractedData,
    billedTo: reconciled.billedTo,
    ourGstMentioned: reconciled.ourGstMentioned,
    billedGstin: reconciled.billedGstin,
    // Only set which-GST from a real BluRidge GSTIN on the bill
    gstEntity: reconciled.gstOnBill,
    gstCheckNote: reconciled.note,
  };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured." },
      { status: 503 },
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const textHint = (formData.get("text") as string) || "";

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let extractedData: Record<string, string | number | boolean | null>;
    let documentText = "";

    if (file) {
      const prepared = await prepareUploadFile(file);
      const base64 = prepared.buffer.toString("base64");
      const mediaType = prepared.mime as
        | "image/jpeg"
        | "image/png"
        | "image/webp"
        | "application/pdf";

      const isImage = mediaType.startsWith("image/");
      const isPdf = mediaType === "application/pdf";

      if (isPdf) {
        documentText = await extractPdfText(prepared.buffer);
      }

      let contentParts: Anthropic.MessageParam["content"];

      if (isImage) {
        contentParts = [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
              data: base64,
            },
          },
          { type: "text", text: buildPrompt(CATEGORY_LIST, documentText) },
        ];
      } else if (isPdf) {
        contentParts = [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64,
            },
          } as Anthropic.DocumentBlockParam,
          { type: "text", text: buildPrompt(CATEGORY_LIST, documentText) },
        ];
      } else {
        return NextResponse.json(
          { error: "Unsupported file type. Please upload an image (JPG/PNG/HEIC) or PDF." },
          { status: 415 },
        );
      }

      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 900,
        messages: [{ role: "user", content: contentParts }],
      });

      const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
      const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      extractedData = JSON.parse(json);
    } else if (textHint) {
      documentText = textHint;
      const msg = await client.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 900,
        messages: [
          {
            role: "user",
            content: `Expense description: "${textHint}"\n\n${buildPrompt(CATEGORY_LIST, textHint)}`,
          },
        ],
      });
      const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
      const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      extractedData = JSON.parse(json);
    } else {
      return NextResponse.json({ error: "No file or text provided" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: applyGstCheck(extractedData, documentText) });
  } catch (err) {
    console.error("[/api/expenses/extract]", err);
    if (err && typeof err === "object" && "status" in err) {
      const { status, error } = uploadErrorResponse(err);
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json({ error: "Extraction failed. Please try again." }, { status: 500 });
  }
}

function buildPrompt(categoryList: string, documentText?: string): string {
  const del = GST_ENTITIES.DEL;
  const raj = GST_ENTITIES.RAJ;
  const ocrBlock =
    documentText && documentText.length > 20
      ? `\n\nOCR / embedded text from the bill (use this to find buyer GSTIN even if glued to labels):\n"""\n${documentText.slice(0, 6000)}\n"""\n`
      : "";

  return `You are an expense extractor for BluRidge Consulting Pvt Ltd (Indian business). Analyze this vendor bill/invoice.

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{
  "vendor": "name of the business/merchant (seller)",
  "amount": <total amount as a number, INR, without ₹ symbol>,
  "date": "YYYY-MM-DD (today if not visible)",
  "invoiceNo": "invoice/receipt number if present, else null",
  "description": "one-line description of what was purchased",
  "gstAmount": <GST amount as number if shown, else null>,
  "paymentMode": "Cash / UPI / Card / Net Banking / NEFT / IMPS / Cheque or null",
  "category": "<one of the category IDs below>",
  "billedTo": "exact Bill To / Billed To / Buyer / Customer name on the invoice, else null",
  "ourGstMentioned": <true if ANY BluRidge GSTIN below appears on the bill as buyer/bill-to GST, else false>,
  "billedGstin": "the 15-char BluRidge GSTIN found on the bill if ourGstMentioned, else null",
  "gstEntity": "DEL if Delhi GSTIN found, RAJ if Rajasthan GSTIN found, else null",
  "confidence": <0.0 to 1.0 — how confident you are about category>,
  "needsReview": <true if confidence < 0.7 or information is unclear>
}

BluRidge GSTINs (buyer side — look under Bill To / Buyer GSTIN / Customer GST / IN GST):
- DEL (Delhi): ${del.gstin} — ${del.legalName}, ${del.city}
- RAJ (Rajasthan): ${raj.gstin} — ${raj.legalName}, ${raj.city}

Available categories (use the ID exactly):
${categoryList}
${ocrBlock}
Rules:
- Use "misc" if none match.
- Set needsReview: true if total amount is not clearly visible, category is ambiguous, or vendor is unknown.
- For Indian bills: check for GST amounts (CGST, SGST, IGST).
- Carefully read "Bill To" / "Billed To" / "Buyer" / "Customer" section for billedTo and whether our GSTIN is printed.
- CRITICAL: ourGstMentioned is TRUE only if one of the BluRidge GSTIN numbers above is literally printed on the bill (buyer/customer GST). Company name alone (e.g. "BLURIDGE CONSULTING PRIVATE LIMITED" without GSTIN) → ourGstMentioned: false, billedGstin: null, gstEntity: null, and still set billedTo to that company name.
- GSTIN may be glued to labels with no space, e.g. "IN GST08AANCB9956E1Z5" or "GSTIN08AANCB9956E1Z5" — still extract billedGstin as the 15-char code "08AANCB9956E1Z5" and set gstEntity to "RAJ" (or "DEL" for the Delhi GSTIN).
- When our GSTIN is present, ALWAYS set gstEntity to "DEL" or "RAJ" accordingly — never leave gstEntity null if ourGstMentioned is true.
- Do NOT set gstEntity to DEL/RAJ based on address or company name alone — only from an exact GSTIN match.
- Dates: convert to YYYY-MM-DD format.`;
}
