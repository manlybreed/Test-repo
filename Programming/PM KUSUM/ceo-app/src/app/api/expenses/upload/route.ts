import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Upload JPG, PNG, WebP, or PDF." },
        { status: 415 },
      );
    }

    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 20 MB." },
        { status: 413 },
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const safeName = `expense_${Date.now()}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "expenses");
    await mkdir(dir, { recursive: true });

    const bytes = await file.arrayBuffer();
    await writeFile(path.join(dir, safeName), Buffer.from(bytes));

    return NextResponse.json({ filePath: `uploads/expenses/${safeName}` });
  } catch (err) {
    console.error("[/api/expenses/upload]", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
