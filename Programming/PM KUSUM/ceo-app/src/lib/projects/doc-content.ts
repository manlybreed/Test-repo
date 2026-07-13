import fs from "fs/promises";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
// Import the lib entry directly — the package root runs a debug harness that
// looks for ./test/data/05-versions-space.pdf and blows up under Next/Turbopack.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import type { ScannedDoc } from "./scan-folder";

type ContentBlock =
  | Anthropic.ImageBlockParam
  | Anthropic.DocumentBlockParam
  | Anthropic.TextBlockParam;

type MediaType = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

/** Soft budget so we stay well under Anthropic's 1M token prompt cap. */
const MAX_CHARS_TOTAL = 180_000; // ~45–60k tokens of text
const MAX_CHARS_PER_DOC = 28_000;
const MAX_BINARY_BYTES_TOTAL = 4 * 1024 * 1024;
/** Per-file budget after optional page-slimming */
const MAX_BINARY_FILE_BYTES = 3.5 * 1024 * 1024;
const MIN_USEFUL_TEXT = 400;

function mediaTypeFor(ext: string): MediaType | null {
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return null;
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

function detectImageMediaType(buf: Buffer): ImageMediaType | null {
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
  return null;
}

function cleanText(s: string): string {
  return s
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** For PPA, land schedule is usually at the end — keep head + tail. */
export function clipDocText(text: string, kindHint: string, maxChars = MAX_CHARS_PER_DOC): string {
  const cleaned = cleanText(text);
  if (cleaned.length <= maxChars) return cleaned;

  const isPpa = /ppa|power\s*purchase/i.test(kindHint);
  if (isPpa) {
    // Land schedule is on the last page(s) — keep a small head + heavy tail
    const head = Math.min(2500, Math.floor(maxChars * 0.12));
    const tail = maxChars - head - 100;
    return (
      cleaned.slice(0, head) +
      "\n\n[… middle PPA pages omitted — LAST PAGE / land schedule below …]\n\n" +
      cleaned.slice(-Math.max(tail, Math.floor(maxChars * 0.75)))
    );
  }

  const isLease = /lease|patta/i.test(kindHint);
  if (isLease) {
    // Lease deeds: need schedule of khasras + tenure — keep head (parties/dates) + tail (schedules)
    const head = Math.floor(maxChars * 0.4);
    const tail = maxChars - head - 80;
    return (
      cleaned.slice(0, head) +
      "\n\n[… middle lease pages omitted …]\n\n" +
      cleaned.slice(-tail)
    );
  }

  // DPR / PVsyst / long reports: keep front matter + mid + tail (costs often mid/end)
  const isDpr = /\bdpr\b|pvsyst|detailed\s*project/i.test(kindHint);
  if (isDpr) {
    const head = Math.floor(maxChars * 0.45);
    const tail = Math.floor(maxChars * 0.35);
    const midBudget = maxChars - head - tail - 120;
    const midStart = Math.floor(cleaned.length * 0.4);
    return (
      cleaned.slice(0, head) +
      "\n\n[… middle omitted …]\n\n" +
      cleaned.slice(midStart, midStart + Math.max(midBudget, 0)) +
      "\n\n[… toward end …]\n\n" +
      cleaned.slice(-tail)
    );
  }

  // Generic long reports: prefer front matter + a mid slice
  const head = Math.floor(maxChars * 0.7);
  const midStart = Math.floor(cleaned.length * 0.45);
  const mid = cleaned.slice(midStart, midStart + (maxChars - head - 80));
  return (
    cleaned.slice(0, head) +
    "\n\n[… middle omitted …]\n\n" +
    mid
  );
}

export async function extractPdfText(absolutePath: string): Promise<{
  text: string;
  pages: number;
} | null> {
  try {
    const buf = await fs.readFile(absolutePath);
    const parsed = await pdfParse(buf, { max: 0 });
    const text = cleanText(parsed.text || "");
    if (!text) return { text: "", pages: parsed.numpages || 0 };
    return { text, pages: parsed.numpages || 0 };
  } catch {
    return null;
  }
}

/**
 * Rajasthan jamabandi / Hindi scans often embed a broken text layer (mojibake).
 * That text looks "long enough" but is unreadable — Claude then hallucinates
 * spellings like Kishangarh instead of Kishanganj. Reject it and use vision.
 */
export function isUsefulPdfText(text: string): boolean {
  const cleaned = cleanText(text);
  if (cleaned.length < MIN_USEFUL_TEXT) return false;

  const compact = cleaned.replace(/\s+/g, "");
  const devanagari = (cleaned.match(/[\u0900-\u097F]/g) || []).length;
  const latinWords = cleaned.match(/[A-Za-z]{3,}/g) || [];
  const latinChars = latinWords.join("").length;
  // Latin-1 / odd symbols common in wrong-encoded Devanagari PDFs
  const mojibake = (cleaned.match(/[\u0080-\u024F]/g) || []).length;

  if (mojibake > compact.length * 0.12 && devanagari < 30) return false;
  if (devanagari < 20 && latinChars < 120) return false;
  // Mostly punctuation / control garbage
  const alnum = (cleaned.match(/[A-Za-z0-9\u0900-\u097F]/g) || []).length;
  if (alnum < cleaned.length * 0.35) return false;
  return true;
}

/** Copy a small set of pages so large lease/PPA scans fit the vision budget. */
export async function slimPdfBuffer(
  buf: Buffer,
  kindHint: string,
  maxBytes = MAX_BINARY_FILE_BYTES,
): Promise<{ buf: Buffer; pagesKept: number; totalPages: number }> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const totalPages = src.getPageCount();
  const kind = kindHint.toLowerCase();

  const buildIndices = (front: number, back: number) => {
    const indices = new Set<number>();
    if (/ppa|power\s*purchase/.test(kind) && totalPages > 4) {
      indices.add(0);
      if (totalPages > 1) indices.add(1);
      if (totalPages > 2) indices.add(totalPages - 2);
      indices.add(totalPages - 1);
      return [...indices].sort((a, b) => a - b);
    }
    for (let i = 0; i < Math.min(front, totalPages); i++) indices.add(i);
    for (let i = Math.max(0, totalPages - back); i < totalPages; i++) indices.add(i);
    return [...indices].sort((a, b) => a - b);
  };

  let front = /lease|patta/.test(kind) ? 2 : 3;
  let back = /lease|patta/.test(kind) ? 2 : 0;
  if (/jamabandi|jama|khatauni|land/.test(kind)) {
    front = Math.min(2, totalPages);
    back = 0;
  }

  let last = buf;
  let kept = totalPages;
  for (const attempt of [
    [front, back],
    [1, 2],
    [1, 1],
    [0, 1],
    [1, 0],
  ] as const) {
    const ordered = buildIndices(attempt[0], attempt[1]);
    if (ordered.length >= totalPages && buf.length <= maxBytes) {
      return { buf, pagesKept: totalPages, totalPages };
    }
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, ordered);
    for (const p of pages) out.addPage(p);
    const slim = Buffer.from(await out.save());
    last = slim;
    kept = ordered.length;
    if (slim.length <= maxBytes) {
      return { buf: slim, pagesKept: kept, totalPages };
    }
  }
  return { buf: last, pagesKept: kept, totalPages };
}

export type DocAttachMode = "text" | "binary" | "skipped";

export type DocAttachResult = {
  doc: ScannedDoc;
  mode: DocAttachMode;
  chars?: number;
  bytes?: number;
  note?: string;
};

/**
 * Build Claude message content from plant docs.
 * Prefer extracted PDF text (cheap tokens). Only attach raw PDF/image when
 * text is missing/sparse and the file is small enough.
 */
export async function docsToAiContent(
  docs: ScannedDoc[],
  opts?: {
    kindHint?: (doc: ScannedDoc) => string;
    maxCharsTotal?: number;
    maxCharsPerDoc?: number;
    maxBinaryBytesTotal?: number;
  },
): Promise<{ content: ContentBlock[]; report: DocAttachResult[] }> {
  const maxCharsTotal = opts?.maxCharsTotal ?? MAX_CHARS_TOTAL;
  const maxCharsPerDoc = opts?.maxCharsPerDoc ?? MAX_CHARS_PER_DOC;
  const maxBinaryTotal = opts?.maxBinaryBytesTotal ?? MAX_BINARY_BYTES_TOTAL;

  const content: ContentBlock[] = [];
  const report: DocAttachResult[] = [];
  let charsUsed = 0;
  let binaryUsed = 0;

  for (const doc of docs) {
    const mediaType = mediaTypeFor(doc.ext);
    if (!mediaType) {
      report.push({ doc, mode: "skipped", note: "unsupported type" });
      continue;
    }

    const kind = opts?.kindHint?.(doc) || path.basename(doc.absolutePath);
    const header = `Document category: ${doc.category}\nPath: ${doc.relativePath}\nFile: ${path.basename(doc.absolutePath)}\nKind hint: ${kind}`;

    if (mediaType === "application/pdf") {
      const extracted = await extractPdfText(doc.absolutePath);
      const raw = extracted?.text || "";
      const textOk = isUsefulPdfText(raw);

      if (textOk) {
        const remain = Math.max(0, maxCharsTotal - charsUsed);
        if (remain < 800) {
          report.push({ doc, mode: "skipped", note: "text budget exhausted" });
          continue;
        }
        const clipped = clipDocText(raw, kind, Math.min(maxCharsPerDoc, remain));
        charsUsed += clipped.length;
        content.push({
          type: "text",
          text: `${header}\nPages: ${extracted?.pages ?? "?"}\nMode: text-extract\n\n----- BEGIN EXTRACTED TEXT -----\n${clipped}\n----- END EXTRACTED TEXT -----`,
        });
        report.push({
          doc,
          mode: "text",
          chars: clipped.length,
          note: `${extracted?.pages ?? "?"} pages`,
        });
        continue;
      }

      // Empty OR garbled text layer → vision via PDF document block
      const full = await fs.readFile(doc.absolutePath);
      let attach: Buffer = full;
      let pageNote = `${extracted?.pages ?? "?"} pages`;
      try {
        const slim = await slimPdfBuffer(full, kind);
        attach = Buffer.from(slim.buf);
        pageNote = `pages ${slim.pagesKept}/${slim.totalPages} (slimmed for vision)`;
      } catch {
        // keep full buffer if slim fails
      }

      if (attach.length > MAX_BINARY_FILE_BYTES || binaryUsed + attach.length > maxBinaryTotal) {
        report.push({
          doc,
          mode: "skipped",
          bytes: attach.length,
          note: textOk
            ? "too large"
            : "garbled/empty text and PDF still too large after slimming",
        });
        continue;
      }

      binaryUsed += attach.length;
      content.push({
        type: "text",
        text: `${header}\nMode: pdf-vision (${
          raw.length ? "embedded text was garbled/unusable" : "no text layer"
        })\n${pageNote}\nREAD THE VISUAL PAGE — do not invent spellings from bad OCR.`,
      });
      content.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: attach.toString("base64"),
        },
      });
      report.push({
        doc,
        mode: "binary",
        bytes: attach.length,
        note: pageNote,
      });
      continue;
    }

    // Images — only if small
    if (doc.size > MAX_BINARY_FILE_BYTES || binaryUsed + doc.size > maxBinaryTotal) {
      report.push({ doc, mode: "skipped", bytes: doc.size, note: "image too large" });
      continue;
    }
    const buf = await fs.readFile(doc.absolutePath);
    const imageType = detectImageMediaType(buf);
    if (!imageType) {
      report.push({ doc, mode: "skipped", note: "unsupported image type" });
      continue;
    }
    binaryUsed += buf.length;
    content.push({ type: "text", text: `${header}\nMode: image` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: imageType,
        data: buf.toString("base64"),
      },
    });
    report.push({ doc, mode: "binary", bytes: buf.length });
  }

  return { content, report };
}

export function formatAnthropicError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Anthropic SDK often puts JSON in the message
  try {
    const jsonMatch = raw.match(/\{[\s\S]*"error"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: { message?: string };
      };
      const msg = parsed.error?.message || raw;
      if (/prompt is too long/i.test(msg)) {
        return "Documents are too large for one AI pass. Retry — the app now extracts PDF text instead of uploading full files. If this persists, remove oversized scanned PDFs from Land KYC / DPR.";
      }
      return msg;
    }
  } catch {
    // ignore
  }
  if (/prompt is too long/i.test(raw)) {
    return "Prompt too long for the model. Retry with the updated text-extract pipeline, or trim huge scanned PDFs.";
  }
  return raw;
}
