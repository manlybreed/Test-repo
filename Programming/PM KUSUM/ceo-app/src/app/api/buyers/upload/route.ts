import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: "Upload JPG, PNG, WebP, or PDF." }, { status: 415 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "File too large (max 20 MB)." }, { status: 413 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
    const safeName = `buyer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "buyers");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeName), Buffer.from(await file.arrayBuffer()));

    return NextResponse.json({ filePath: `uploads/buyers/${safeName}`, fileName: file.name });
  } catch (err) {
    console.error("[/api/buyers/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
