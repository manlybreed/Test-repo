import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Scoped to any mailbox the user owns, not just the one env-configured
  // account — an attachment on accounts@/pmkusum@ must be just as
  // downloadable as one on akshay@.
  const att = await prisma.mailAttachment.findFirst({
    where: {
      id,
      message: { account: { userId: session.user.id } },
    },
  });

  if (!att?.storagePath) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const storageRoot = path.resolve(process.env.STORAGE_ROOT || "./storage");
  const abs = path.resolve(att.storagePath);
  if (!abs.startsWith(storageRoot) && !abs.includes(`${path.sep}mail${path.sep}`)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const buf = await fs.readFile(abs);
    const filename = att.filename.replace(/"/g, "");
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": att.contentType || "application/octet-stream",
        "Content-Length": String(buf.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }
}
