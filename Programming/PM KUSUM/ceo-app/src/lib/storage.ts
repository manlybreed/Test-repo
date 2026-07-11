import fs from "fs/promises";
import path from "path";

export function storageRoot(): string {
  return path.resolve(process.cwd(), process.env.STORAGE_ROOT || "./storage");
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeStorageFile(
  category: "agreements" | "invoices" | "salary-slips",
  filename: string,
  data: Buffer | Uint8Array,
): Promise<string> {
  const dir = path.join(storageRoot(), category);
  await ensureDir(dir);
  const full = path.join(dir, filename);
  await fs.writeFile(full, data);
  return path.join(category, filename);
}

export function resolveStoragePath(relativePath: string): string {
  const full = path.join(storageRoot(), relativePath);
  const root = storageRoot();
  if (!full.startsWith(root)) {
    throw new Error("Invalid storage path");
  }
  return full;
}

export async function deleteStorageFile(relativePath: string | null | undefined) {
  if (!relativePath) return;
  try {
    await fs.unlink(resolveStoragePath(relativePath));
  } catch {
    // File may already be gone — ignore
  }
}
