import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveSafePlantPath } from "@/lib/projects/plant-folder";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  let body: { paths?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paths = Array.isArray(body.paths)
    ? [...new Set(body.paths.map((p) => String(p).trim()).filter(Boolean))]
    : [];
  if (paths.length === 0) {
    return NextResponse.json({ error: "paths required" }, { status: 400 });
  }
  if (paths.length > 200) {
    return NextResponse.json({ error: "Too many paths" }, { status: 400 });
  }

  const plant = await prisma.kusumPlant.findUnique({ where: { id } });
  if (!plant) {
    return NextResponse.json({ error: "Plant not found" }, { status: 404 });
  }

  const safeRels: string[] = [];
  for (const rel of paths) {
    try {
      const abs = resolveSafePlantPath(plant.folderPath, rel);
      await fs.access(abs);
      safeRels.push(path.relative(path.resolve(plant.folderPath), abs));
    } catch {
      // skip missing / invalid
    }
  }
  if (safeRels.length === 0) {
    return NextResponse.json({ error: "No readable files" }, { status: 404 });
  }

  const tmpZip = path.join(
    os.tmpdir(),
    `kusum-${id.slice(0, 8)}-${Date.now()}.zip`,
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("zip", ["-q", tmpZip, ...safeRels], {
        cwd: path.resolve(plant.folderPath),
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`zip exited ${code}`));
      });
    });

    const buf = await fs.readFile(tmpZip);
    const safeName = (plant.plantShort || plant.name || "plant")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 60);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-files.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Zip failed" },
      { status: 500 },
    );
  } finally {
    await fs.unlink(tmpZip).catch(() => undefined);
  }
}
