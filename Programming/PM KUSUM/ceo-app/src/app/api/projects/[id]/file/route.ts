import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSafePlantPath } from "@/lib/projects/plant-folder";

function contentTypeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const relativePath = req.nextUrl.searchParams.get("path");
  const download = req.nextUrl.searchParams.get("download") === "1";

  if (!relativePath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const plant = await prisma.kusumPlant.findUnique({ where: { id } });
  if (!plant) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  let abs: string;
  try {
    abs = resolveSafePlantPath(plant.folderPath, relativePath);
  } catch {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs);
    const headers: Record<string, string> = {
      "Content-Type": contentTypeFor(ext),
      "Cache-Control": "private, max-age=60",
    };
    if (download) {
      headers["Content-Disposition"] =
        `attachment; filename="${path.basename(abs).replace(/"/g, "")}"`;
    } else {
      headers["Content-Disposition"] =
        `inline; filename="${path.basename(abs).replace(/"/g, "")}"`;
    }
    return new NextResponse(buf, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
