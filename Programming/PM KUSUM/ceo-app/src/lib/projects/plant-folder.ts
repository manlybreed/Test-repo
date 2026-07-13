import fs from "fs/promises";
import path from "path";
import { PLANT_SUBFOLDERS } from "./doc-catalog";

/** Ensure relative path cannot escape plant root. */
export function resolveSafePlantPath(folderPath: string, relativePath: string): string {
  const root = path.resolve(folderPath);
  const resolved = path.resolve(root, relativePath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Invalid file path");
  }
  return resolved;
}

export async function ensurePlantSkeleton(plantFolderAbs: string): Promise<void> {
  await fs.mkdir(plantFolderAbs, { recursive: true });
  for (const sub of PLANT_SUBFOLDERS) {
    await fs.mkdir(path.join(plantFolderAbs, sub), { recursive: true });
  }
}

/**
 * Create `{plantsRoot}/{legalName}/` with standard KYC subfolders.
 * Fails if the folder already exists (non-empty collision).
 */
export async function createPlantFolderUnderRoot(
  plantsRoot: string,
  legalName: string,
): Promise<string> {
  const root = path.resolve(plantsRoot);
  let st;
  try {
    st = await fs.stat(root);
  } catch {
    throw new Error(`Plants root not found: ${root}`);
  }
  if (!st.isDirectory()) throw new Error("Plants root is not a directory");

  const safeName = legalName.trim().replace(/[\\/]+/g, "-");
  if (!safeName) throw new Error("Plant name required");
  const plantPath = path.join(root, safeName);

  try {
    await fs.access(plantPath);
    throw new Error(`Folder already exists: ${plantPath}`);
  } catch (err) {
    if (err instanceof Error && /already exists/i.test(err.message)) throw err;
    // does not exist — ok
  }

  await ensurePlantSkeleton(plantPath);
  return plantPath;
}

export async function ensureDirectorFolder(
  plantFolderAbs: string,
  folderName: string,
): Promise<string> {
  const dir = path.join(plantFolderAbs, "Directors KYC", folderName.trim());
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
