import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { panFromGstin, stateFromGstin } from "@/lib/indian-states";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 8;

const EXTRACT_PROMPT = `You are extracting Indian company / buyer master data from one or more KYC / registration documents.

Documents may include any mix of:
- Certificate of Incorporation (COI) / MCA certificate
- PAN card / PAN allotment letter
- GST registration certificate (Form GST REG-06) or GSTIN certificate
- Address proof, company letterhead, or similar

Merge information across ALL attached documents into ONE buyer profile. Prefer official registration documents over letterheads. If fields conflict, prefer GST certificate for GSTIN/address and COI for legal name/CIN.

Return ONLY JSON (no markdown):
{
  "name": "legal company / buyer name",
  "tradeName": "trade name if different, else null",
  "addressLine1": "building / street line",
  "addressLine2": "locality / area if present, else null",
  "city": "city / town",
  "state": "Indian state name",
  "stateCode": "2-digit GST state code (e.g. 07 Delhi, 08 Rajasthan)",
  "pincode": "6-digit PIN",
  "gstin": "15-char GSTIN if found, else null",
  "pan": "10-char PAN if found, else null",
  "cin": "CIN if found on COI, else null",
  "email": "email if present, else null",
  "phone": "phone / mobile if present, else null",
  "documentsDetected": ["COI" | "PAN" | "GST" | "OTHER", ...],
  "notes": "brief note of what was found / any ambiguity",
  "confidence": 0.0-1.0
}

Rules:
- name must be the legal entity name when available.
- Derive PAN from GSTIN characters 3–12 if PAN card is missing but GSTIN is present.
- Derive state + stateCode from GSTIN prefix if state is missing.
- All amounts / IDs uppercase where appropriate (GSTIN, PAN).
- If a field is not visible, use null — do not invent.`;

type MediaType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

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

    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: `${file.name} is too large (max 20 MB).` }, { status: 413 });
      }
      const mediaType = (file.type || "application/pdf") as MediaType;
      const isImage = mediaType.startsWith("image/");
      const isPdf = mediaType === "application/pdf";
      if (!isImage && !isPdf) {
        return NextResponse.json(
          { error: `Unsupported type: ${file.name}. Upload JPG, PNG, WebP, or PDF.` },
          { status: 415 },
        );
      }

      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      contentParts.push({ type: "text", text: `Document filename: ${file.name}` });
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
      max_tokens: 1024,
      messages: [{ role: "user", content: contentParts }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
    const json = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const extracted = JSON.parse(json) as Record<string, unknown>;

    // Enrich from GSTIN when AI omitted PAN / state
    const gstin = typeof extracted.gstin === "string" ? extracted.gstin.trim().toUpperCase() : null;
    if (gstin) {
      extracted.gstin = gstin;
      if (!extracted.pan) {
        const pan = panFromGstin(gstin);
        if (pan) extracted.pan = pan;
      }
      if (!extracted.stateCode || !extracted.state) {
        const st = stateFromGstin(gstin);
        if (st) {
          extracted.stateCode = extracted.stateCode || st.stateCode;
          extracted.state = extracted.state || st.state;
        }
      }
    }
    if (typeof extracted.pan === "string") {
      extracted.pan = extracted.pan.trim().toUpperCase();
    }

    return NextResponse.json({ ok: true, data: extracted });
  } catch (err) {
    console.error("[/api/buyers/extract]", err);
    return NextResponse.json({ error: "Extraction failed. Please try again." }, { status: 500 });
  }
}
