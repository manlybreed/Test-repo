import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const EXTRACT_PROMPT = `You are an invoice data extractor for an Indian business. Analyze this invoice and extract all information you can find.

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{
  "invoiceNumber": "invoice number / receipt number (e.g. INV-001, #12345)",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD or null if not present",
  "buyerName": "client / buyer company or individual name",
  "buyerAddress": "full buyer address as a single string",
  "buyerGstin": "buyer GSTIN if shown, else null",
  "buyerState": "buyer state name",
  "buyerStateCode": "2-digit state code (e.g. 07 for Delhi, 29 for Karnataka)",
  "sellerName": "seller / vendor company name",
  "sellerGstin": "seller GSTIN if shown, else null",
  "serviceDesc": "brief description of the service or product — 1-2 sentences",
  "lines": [
    {
      "description": "line item description",
      "hsn": "HSN/SAC code if shown, else null",
      "quantity": <number or 1>,
      "rate": <unit rate as number>,
      "amount": <line total as number>
    }
  ],
  "taxableTotal": <subtotal before tax, as number>,
  "cgstAmount": <CGST amount as number, 0 if not present>,
  "sgstAmount": <SGST amount as number, 0 if not present>,
  "igstAmount": <IGST amount as number, 0 if not present>,
  "grandTotal": <total including all taxes, as number>,
  "paymentStatus": "PAID or UNPAID or PARTIAL or OVERDUE — infer from context, default UNPAID",
  "gstEntity": "DEL or RAJ — which BluRidge GST registration raised this invoice. DEL = GSTIN 07AANCB9956E1Z7 (Delhi). RAJ = GSTIN 08AANCB9956E1Z5 (Rajasthan). Match the SELLER GSTIN / address, not the buyer.",
  "remarks": "any remarks, reference numbers, or notes on the invoice",
  "currency": "INR or USD etc.",
  "confidence": <0.0 to 1.0>
}

Rules:
- All amounts must be numbers (no ₹ symbol, no commas).
- If a field is not visible, use null.
- For Indian invoices: look for CGST/SGST (same-state) or IGST (inter-state).
- Infer paymentStatus: if you see "PAID", "Payment Received", or a payment date — use PAID. If past due date — OVERDUE. Otherwise UNPAID.
- If lines are not itemized, create one line with the service description and total taxable amount.`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured." }, { status: 503 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File too large (max 20 MB)" }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const mediaType = file.type as "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

    const isImage = mediaType.startsWith("image/");
    const isPdf = mediaType === "application/pdf";

    if (!isImage && !isPdf) {
      return NextResponse.json(
        { error: "Unsupported file type. Upload JPG, PNG, WebP, or PDF." },
        { status: 415 },
      );
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    type ContentBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | Anthropic.TextBlockParam;

    const contentParts: ContentBlock[] = isImage
      ? [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as "image/jpeg" | "image/png" | "image/webp", data: base64 },
          },
          { type: "text", text: EXTRACT_PROMPT },
        ]
      : [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          } as Anthropic.DocumentBlockParam,
          { type: "text", text: EXTRACT_PROMPT },
        ];

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: contentParts }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const extracted = JSON.parse(json);

    return NextResponse.json({ ok: true, data: extracted });
  } catch (err) {
    console.error("[/api/invoices/extract]", err);
    return NextResponse.json({ error: "Extraction failed. Please try again." }, { status: 500 });
  }
}
