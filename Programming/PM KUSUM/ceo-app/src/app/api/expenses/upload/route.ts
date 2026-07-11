import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

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
