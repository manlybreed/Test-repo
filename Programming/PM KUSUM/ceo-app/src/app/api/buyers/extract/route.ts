import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { panFromGstin, stateFromGstin } from "@/lib/indian-states";
import { prepareUploadFile } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 120;

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

type MediaMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

type IncomingFile = {
  name: string;
  mime?: string;
  data: string; // base64
};

function sniffMime(buf: Buffer, name: string, hinted?: string): MediaMime | null {
  const hint = (hinted || "").toLowerCase();
  if (
    hint === "image/jpeg" ||
    hint === "image/png" ||
    hint === "image/webp" ||
    hint === "application/pdf"
  ) {
    return hint;
  }
  if (buf.length >= 4 && buf.toString("ascii", 0, 4) === "%PDF") return "application/pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return null;
}

async function parseIncoming(req: NextRequest): Promise<IncomingFile[]> {
  const contentType = req.headers.get("content-type") || "";

  // Preferred: JSON body — avoids multipart boundary bugs in some Next/Turbopack setups.
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { files?: IncomingFile[] };
    if (!Array.isArray(body.files) || body.files.length === 0) {
      throw Object.assign(new Error("No files provided"), { status: 400 });
    }
    return body.files;
  }

  // Fallback: multipart (legacy)
  const formData = await req.formData();
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    throw Object.assign(new Error("No files provided"), { status: 400 });
  }
  const out: IncomingFile[] = [];
  for (const file of files) {
    const prepared = await prepareUploadFile(file);
    out.push({
      name: file.name,
      mime: prepared.mime,
      data: prepared.buffer.toString("base64"),
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured." },
      { status: 503 },
    );
  }

  try {
    const incoming = await parseIncoming(req);
    if (incoming.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Max ${MAX_FILES} documents at once.` },
        { status: 400 },
      );
    }

    type ContentBlock =
      | Anthropic.ImageBlockParam
      | Anthropic.DocumentBlockParam
      | Anthropic.TextBlockParam;
    const contentParts: ContentBlock[] = [];

    for (const file of incoming) {
      const buffer = Buffer.from(file.data, "base64");
      if (!buffer.length) {
        return NextResponse.json(
          { error: `${file.name || "File"} is empty.` },
          { status: 400 },
        );
      }
      if (buffer.length > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `${file.name || "File"} is too large (max 20 MB).` },
          { status: 413 },
        );
      }
      const mime = sniffMime(buffer, file.name || "doc", file.mime);
      if (!mime) {
        return NextResponse.json(
          { error: `Unsupported type: ${file.name || "file"}` },
          { status: 415 },
        );
      }

      const base64 = buffer.toString("base64");
      contentParts.push({
        type: "text",
        text: `Document filename: ${file.name || "document"}`,
      });
      if (mime.startsWith("image/")) {
        contentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mime as "image/jpeg" | "image/png" | "image/webp",
            data: base64,
          },
        });
      } else {
        contentParts.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        } as Anthropic.DocumentBlockParam);
      }
    }

    contentParts.push({ type: "text", text: EXTRACT_PROMPT });

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1600,
      messages: [{ role: "user", content: contentParts }],
    });

    const raw =
      msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "{}";
    const json = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(json) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "AI returned unreadable data. Try again or fill manually." },
        { status: 502 },
      );
    }

    const gstin =
      typeof extracted.gstin === "string"
        ? extracted.gstin.trim().toUpperCase()
        : null;
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
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Extraction failed. Please try again.";
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status: number }).status) || 500
        : 500;
    // FormData boundary failures often surface as generic fetch errors on the client
    if (/FormData|boundary|aborted|ECONNRESET/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Could not read the uploaded documents. Refresh the page and try Extract again.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: message }, { status });
  }
}
