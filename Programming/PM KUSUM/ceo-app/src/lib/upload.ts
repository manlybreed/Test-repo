import { createHash } from "crypto";
import path from "path";

/** MIME types accepted after optional HEIC→JPEG conversion. */
export const UPLOAD_OUTPUT_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/** MIME types we accept from the client (includes Apple HEIC/HEIF). */
export const UPLOAD_INPUT_MIMES = new Set([
  ...UPLOAD_OUTPUT_MIMES,
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Client `<input accept>` for image+PDF uploads including HEIC. */
export const UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf";

export const UPLOAD_ACCEPT_IMAGES =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

export type PreparedUpload = {
  buffer: Buffer;
  mime: string;
  ext: string;
  originalName: string;
  convertedFromHeic: boolean;
  contentHash: string;
};

function looksLikeHeic(buf: Buffer, mime: string, name: string): boolean {
  const m = (mime || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (m.includes("heic") || m.includes("heif")) return true;
  if (n.endsWith(".heic") || n.endsWith(".heif")) return true;
  // ftyp....heic / heif / mif1
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12).toLowerCase();
    if (["heic", "heif", "mif1", "msf1", "hevx"].includes(brand)) return true;
  }
  return false;
}

function extForMime(mime: string, fallback = "bin"): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "application/pdf") return "pdf";
  return fallback;
}

async function convertHeicToJpeg(buf: Buffer): Promise<Buffer> {
  const mod = await import("heic-convert");
  const convert = mod.default as unknown as (opts: {
    buffer: Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  }) => Promise<ArrayBuffer | Uint8Array>;
  const out = await convert({ buffer: buf, format: "JPEG", quality: 0.9 });
  return Buffer.from(out as Uint8Array);
}

/**
 * Validate + optionally convert HEIC → JPEG so downstream AI/storage always
 * sees a supported format.
 */
export async function prepareUploadFile(
  file: File,
  opts?: { maxBytes?: number },
): Promise<PreparedUpload> {
  const maxBytes = opts?.maxBytes ?? MAX_UPLOAD_BYTES;
  if (file.size > maxBytes) {
    throw Object.assign(new Error(`File too large. Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`), {
      status: 413,
    });
  }

  const originalName = file.name || "upload";
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let mime = (file.type || "").toLowerCase() || "application/octet-stream";
  let convertedFromHeic = false;

  // Browsers often send HEIC as empty type or application/octet-stream
  if (looksLikeHeic(buffer, mime, originalName)) {
    try {
      buffer = Buffer.from(await convertHeicToJpeg(buffer));
      mime = "image/jpeg";
      convertedFromHeic = true;
    } catch (err) {
      throw Object.assign(
        new Error(
          `Could not convert HEIC image. Try exporting as JPG from Photos. (${
            err instanceof Error ? err.message : "convert failed"
          })`,
        ),
        { status: 415 },
      );
    }
  }

  if (!UPLOAD_OUTPUT_MIMES.has(mime)) {
    // Last chance: sniff PDF / common images by magic bytes
    if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
      mime = "application/pdf";
    } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      mime = "image/jpeg";
    } else if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      mime = "image/png";
    } else if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      mime = "image/webp";
    }
  }

  if (!UPLOAD_OUTPUT_MIMES.has(mime)) {
    throw Object.assign(
      new Error("Invalid file type. Upload JPG, PNG, WebP, HEIC, or PDF."),
      { status: 415 },
    );
  }

  const ext = convertedFromHeic
    ? "jpg"
    : extForMime(mime, path.extname(originalName).replace(".", "") || "bin");

  const contentHash = createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    mime,
    ext,
    originalName,
    convertedFromHeic,
    contentHash,
  };
}

export function uploadErrorResponse(err: unknown): { status: number; error: string } {
  if (err && typeof err === "object" && "status" in err && "message" in err) {
    const e = err as { status: number; message: string };
    return { status: e.status || 500, error: e.message };
  }
  return { status: 500, error: "Upload failed" };
}

/** Normalize invoice / receipt numbers for duplicate matching. */
export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .toUpperCase()
    .replace(/^#+/, "")
    .replace(/[\s._\-_/\\]+/g, "")
    .replace(/^0+(?=\d)/, "");
}

export function invoiceNumbersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeInvoiceNumber(a);
  const nb = normalizeInvoiceNumber(b);
  if (!na || !nb) return false;
  return na === nb;
}
