import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

const EXTRACT_PROMPT = `You are an Indian HR KYC document classifier and data extractor.

You will receive multiple files for ONE employee onboarding pack. Each file is labeled with FILE_INDEX and a filename.

Step 1 — CLASSIFY every file (exactly one primary type each):
- PAN — PAN card
- AADHAAR — Aadhaar card
- PHOTO — passport / profile photograph of the person (not a document scan of text-heavy card unless it's clearly only a photo)
- SALARY_SLIP — salary slip / pay slip / CTC breakup sheet
- AGREEMENT — employment agreement / appointment / offer letter
- BANK_PASSBOOK — bank passbook page
- BANK_STATEMENT — bank account statement / cancelled cheque
- OTHER — anything else

Step 2 — EXTRACT and MERGE a single employee profile from all files.

Return ONLY JSON (no markdown):
{
  "classifications": [
    {
      "fileIndex": <0-based index matching FILE_INDEX>,
      "fileName": "original filename",
      "kind": "PAN"|"AADHAAR"|"PHOTO"|"SALARY_SLIP"|"AGREEMENT"|"BANK_PASSBOOK"|"BANK_STATEMENT"|"OTHER",
      "confidence": 0.0-1.0,
      "reason": "short why"
    }
  ],
  "name": "full legal name as on PAN/Aadhaar",
  "email": "personal email if present on documents, else null",
  "phone": "mobile / contact number if present, else null",
  "pan": "10-char PAN if found, else null",
  "aadhaar": "12-digit Aadhaar if found (may be masked), else null",
  "uan": "UAN if present, else null",
  "designation": "job title / position if present, else null",
  "department": "department if present, else null",
  "addressLine1": "residential address line if present",
  "city": "city",
  "state": "state",
  "pincode": "PIN",
  "bankAccount": "bank account number",
  "bankIfsc": "IFSC code",
  "bankName": "bank name",
  "bankBranch": "branch name if present",
  "basic": <number or null>,
  "hra": <number or null>,
  "special": <number or null>,
  "otherAllow": <number or null>,
  "pf": <number or null>,
  "professionalTax": <number or null>,
  "tdsPercent": <number or null — TDS rate as percent if shown, else null>,
  "otherDeduct": <number or null>,
  "joinDate": "YYYY-MM-DD or null",
  "dateOfBirth": "YYYY-MM-DD from Aadhaar / documents if present, else null",
  "documentsDetected": ["PAN"|"AADHAAR"|...],
  "notes": "brief note of ambiguities",
  "confidence": 0.0-1.0
}

Rules:
- classifications MUST include every FILE_INDEX exactly once.
- Prefer PAN/Aadhaar for legal name. Prefer salary slip for salary breakup.
- Prefer passbook / statement / cheque for bank details.
- All amounts as numbers (no ₹, no commas). Use null if not visible — do not invent.
- PAN uppercase. Strip spaces from Aadhaar / account numbers where clear.`;

type MediaType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

const KIND_ALIASES: Record<string, string> = {
  PAN: "PAN",
  AADHAAR: "AADHAAR",
  AADHAR: "AADHAAR",
  PHOTO: "PHOTO",
  PHOTOGRAPH: "PHOTO",
  SALARY_SLIP: "SALARY_SLIP",
  SALARY: "SALARY_SLIP",
  AGREEMENT: "AGREEMENT",
  BANK_PASSBOOK: "BANK_PASSBOOK",
  BANK_STATEMENT: "BANK_STATEMENT",
  BANK: "BANK_STATEMENT",
  OTHER: "OTHER",
};

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
    const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Max ${MAX_FILES} documents at once.` }, { status: 400 });
    }

    type ContentBlock = Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam | Anthropic.TextBlockParam;
    const contentParts: ContentBlock[] = [];

    contentParts.push({
      type: "text",
      text: `There are ${files.length} file(s). Classify each by FILE_INDEX, then extract merged employee data.`,
    });

    files.forEach((file, index) => {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error(`${file.name} is too large (max 20 MB).`);
      }
      const mediaType = (file.type || "application/pdf") as MediaType;
      const isImage = mediaType.startsWith("image/");
      const isPdf = mediaType === "application/pdf";
      if (!isImage && !isPdf) {
        throw new Error(`Unsupported type: ${file.name}. Upload JPG, PNG, WebP, or PDF.`);
      }
    });

    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const mediaType = (file.type || "application/pdf") as MediaType;
      const isImage = mediaType.startsWith("image/");
      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

      contentParts.push({
        type: "text",
        text: `FILE_INDEX: ${index}\nFILENAME: ${file.name}`,
      });
      if (isImage) {
        contentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/webp",
            data: base64,
          },
        });
      } else {
        contentParts.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        } as Anthropic.DocumentBlockParam);
      }
    }

    contentParts.push({ type: "text", text: EXTRACT_PROMPT });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{ role: "user", content: contentParts }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const extracted = JSON.parse(json) as Record<string, unknown>;

    if (typeof extracted.pan === "string") extracted.pan = extracted.pan.trim().toUpperCase();
    if (typeof extracted.bankIfsc === "string") extracted.bankIfsc = extracted.bankIfsc.trim().toUpperCase();
    if (typeof extracted.aadhaar === "string") {
      const digits = extracted.aadhaar.replace(/\D/g, "").slice(0, 12);
      const parts: string[] = [];
      for (let i = 0; i < digits.length; i += 4) parts.push(digits.slice(i, i + 4));
      extracted.aadhaar = parts.join("-");
    }

    // Normalize classifications to cover every file
    const rawClass = Array.isArray(extracted.classifications)
      ? (extracted.classifications as Record<string, unknown>[])
      : [];
    const byIndex = new Map<number, Record<string, unknown>>();
    for (const c of rawClass) {
      const idx = Number(c.fileIndex);
      if (Number.isInteger(idx) && idx >= 0 && idx < files.length) byIndex.set(idx, c);
    }

    const classifications = files.map((file, index) => {
      const c = byIndex.get(index);
      const rawKind = String(c?.kind ?? "OTHER").toUpperCase().replace(/\s+/g, "_");
      const kind = KIND_ALIASES[rawKind] || "OTHER";
      return {
        fileIndex: index,
        fileName: file.name,
        kind,
        confidence: typeof c?.confidence === "number" ? c.confidence : 0.7,
        reason: typeof c?.reason === "string" ? c.reason : "",
      };
    });

    extracted.classifications = classifications;
    extracted.documentsDetected = [...new Set(classifications.map((c) => c.kind))];

    return NextResponse.json({ ok: true, data: extracted });
  } catch (err) {
    console.error("[/api/employees/extract]", err);
    const message = err instanceof Error ? err.message : "Extraction failed. Please try again.";
    const status =
      message.includes("too large") ? 413 : message.includes("Unsupported") ? 415 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
