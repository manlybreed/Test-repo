import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const CATEGORY_LIST = EXPENSE_CATEGORIES.map((c) => `${c.id}: ${c.label}`).join("\n");

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const textHint = (formData.get("text") as string) || "";

    let extractedData: Record<string, string | number | boolean>;

    if (file) {
      // Vision extraction from image/PDF
      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const mediaType = (file.type || "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp"
        | "application/pdf";

      const isImage = mediaType.startsWith("image/");

      const contentParts: Anthropic.MessageParam["content"] = isImage
        ? [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: base64 },
            },
            {
              type: "text",
              text: buildPrompt(CATEGORY_LIST),
            },
          ]
        : [
            {
              type: "text",
              text: `PDF bill uploaded (base64 omitted for brevity). ${textHint}\n\n${buildPrompt(CATEGORY_LIST)}`,
            },
          ];

      const msg = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 512,
        messages: [{ role: "user", content: contentParts }],
      });

      const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
      const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      extractedData = JSON.parse(json);
    } else if (textHint) {
      // Text-only fallback (manual hint)
      const msg = await client.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `Expense description: "${textHint}"\n\n${buildPrompt(CATEGORY_LIST)}`,
          },
        ],
      });
      const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
      const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      extractedData = JSON.parse(json);
    } else {
      return NextResponse.json({ error: "No file or text provided" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: extractedData });
  } catch (err) {
    console.error("[/api/expenses/extract]", err);
    return NextResponse.json({ error: "Extraction failed." }, { status: 500 });
  }
}

function buildPrompt(categoryList: string): string {
  return `You are an expense extractor for an Indian business. Analyze this bill/invoice and extract the following information.

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{
  "vendor": "name of the business/merchant",
  "amount": <total amount as a number, INR, without ₹ symbol>,
  "date": "YYYY-MM-DD (today if not visible)",
  "invoiceNo": "invoice/receipt number if present, else null",
  "description": "one-line description of what was purchased",
  "gstAmount": <GST amount as number if shown, else null>,
  "paymentMode": "Cash / UPI / Card / Net Banking / NEFT / IMPS / Cheque or null",
  "category": "<one of the category IDs below>",
  "confidence": <0.0 to 1.0 — how confident you are about category>,
  "needsReview": <true if confidence < 0.7 or information is unclear>
}

Available categories (use the ID exactly):
${categoryList}

Rules:
- Use "misc" if none match.
- Set needsReview: true if total amount is not clearly visible, category is ambiguous, or vendor is unknown.
- For Indian bills: check for GST amounts (CGST, SGST, IGST).
- Dates: convert to YYYY-MM-DD format.`;
}
