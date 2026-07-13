import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { prepareUploadFile, uploadErrorResponse } from "@/lib/upload";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const kind = (formData.get("kind") as string) || "misc";
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

    const prepared = await prepareUploadFile(file);
    const safeKind = kind.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "misc";
    const safeName = `emp_${safeKind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${prepared.ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "employees");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, safeName), prepared.buffer);

    return NextResponse.json({
      filePath: `uploads/employees/${safeName}`,
      fileName: file.name,
      kind: safeKind,
      mime: prepared.mime,
      convertedFromHeic: prepared.convertedFromHeic,
      contentHash: prepared.contentHash,
    });
  } catch (err) {
    console.error("[/api/employees/upload]", err);
    const { status, error } = uploadErrorResponse(err);
    return NextResponse.json({ error }, { status });
  }
}
