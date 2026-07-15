import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { prepareUploadFile, uploadErrorResponse } from "@/lib/upload";

export const runtime = "nodejs";

function sniffExt(name: string, mime?: string): string {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  const fromName = path.extname(name).replace(".", "").toLowerCase();
  if (fromName) return fromName;
  return "bin";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") || "";
    let buffer: Buffer;
    let originalName: string;
    let mime: string;
    let ext: string;
    let convertedFromHeic = false;
    let contentHash: string | undefined;

    if (contentType.includes("application/json")) {
      const body = (await req.json()) as {
        name?: string;
        mime?: string;
        data?: string;
      };
      if (!body.data) {
        return NextResponse.json({ error: "No file data" }, { status: 400 });
      }
      buffer = Buffer.from(body.data, "base64");
      originalName = body.name || "upload.bin";
      mime = body.mime || "application/octet-stream";
      const file = new File([new Uint8Array(buffer)], originalName, {
        type: mime,
      });
      const prepared = await prepareUploadFile(file);
      buffer = prepared.buffer;
      mime = prepared.mime;
      ext = prepared.ext;
      convertedFromHeic = prepared.convertedFromHeic;
      contentHash = prepared.contentHash;
    } else {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

      const prepared = await prepareUploadFile(file);
      buffer = prepared.buffer;
      originalName = file.name;
      mime = prepared.mime;
      ext = prepared.ext;
      convertedFromHeic = prepared.convertedFromHeic;
      contentHash = prepared.contentHash;
    }

    if (!ext) ext = sniffExt(originalName, mime);

    const safeName = `buyer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "buyers");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeName), buffer);

    return NextResponse.json({
      filePath: `uploads/buyers/${safeName}`,
      fileName: originalName,
      mime,
      convertedFromHeic,
      contentHash,
    });
  } catch (err) {
    console.error("[/api/buyers/upload]", err);
    const aborted =
      err instanceof Error &&
      (/aborted|ECONNRESET|FormData|boundary/i.test(err.message) ||
        (err as { code?: string }).code === "ECONNRESET");
    if (aborted) {
      return NextResponse.json(
        { error: "Upload was interrupted. Please try again." },
        { status: 400 },
      );
    }
    const { status, error } = uploadErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
