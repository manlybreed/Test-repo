import fs from "fs/promises";
import path from "path";

/** Canonical category names used in the app. */
export const EXPECTED_FOLDERS = [
  "Directors KYC",
  "DPR From EPC",
  "EPC KYC",
  "Invoices",
  "Land KYC",
  "Misc",
  "Plant KYC",
  "SPV KYC",
  "Third Party Reports",
] as const;

/** On-disk aliases → canonical category */
const FOLDER_ALIASES: Record<string, string> = {
  "Director KYC": "Directors KYC",
  "Directors KYC": "Directors KYC",
};

const DOC_EXT = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
]);

export type ScannedDoc = {
  category: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  ext: string;
  mtimeMs?: number;
};

export type FolderScan = {
  root: string;
  foldersPresent: string[];
  foldersMissing: string[];
  documents: ScannedDoc[];
};

export async function resolvePlantFolder(inputPath: string): Promise<string> {
  const trimmed = inputPath.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) throw new Error("Folder path is required");
  if (!path.isAbsolute(trimmed)) {
    throw new Error("Use an absolute folder path (e.g. /Users/…/Plant Name)");
  }
  const resolved = path.resolve(trimmed);
  let st;
  try {
    st = await fs.stat(resolved);
  } catch {
    throw new Error(`Folder not found: ${resolved}`);
  }
  if (!st.isDirectory()) throw new Error("Path is not a directory");
  return resolved;
}

function canonicalizeFolderName(name: string): string {
  return FOLDER_ALIASES[name] || name;
}

async function walk(
  dir: string,
  root: string,
  category: string,
  out: ScannedDoc[],
  depth = 0,
  maxFiles = 400,
): Promise<void> {
  if (depth > 8 || out.length >= maxFiles) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      await walk(abs, root, category, out, depth + 1, maxFiles);
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!DOC_EXT.has(ext)) continue;
    const st = await fs.stat(abs);
    if (st.size < 200 || st.size > 120 * 1024 * 1024) continue;
    out.push({
      category,
      relativePath: path.relative(root, abs),
      absolutePath: abs,
      size: st.size,
      ext,
      mtimeMs: st.mtimeMs,
    });
  }
}

export async function scanPlantFolder(folderPath: string): Promise<FolderScan> {
  const root = await resolvePlantFolder(folderPath);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const presentCanonical = new Set<string>();
  const folderWalkList: { diskName: string; category: string }[] = [];

  for (const diskName of dirNames) {
    const category = canonicalizeFolderName(diskName);
    if ((EXPECTED_FOLDERS as readonly string[]).includes(category)) {
      presentCanonical.add(category);
      folderWalkList.push({ diskName, category });
    }
  }

  const foldersPresent = EXPECTED_FOLDERS.filter((n) => presentCanonical.has(n));
  const foldersMissing = EXPECTED_FOLDERS.filter((n) => !presentCanonical.has(n));

  const documents: ScannedDoc[] = [];
  for (const { diskName, category } of folderWalkList) {
    await walk(path.join(root, diskName), root, category, documents);
  }

  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!DOC_EXT.has(ext)) continue;
    const abs = path.join(root, ent.name);
    const st = await fs.stat(abs);
    if (st.size < 200 || st.size > 120 * 1024 * 1024) continue;
    documents.push({
      category: "Root",
      relativePath: ent.name,
      absolutePath: abs,
      size: st.size,
      ext,
      mtimeMs: st.mtimeMs,
    });
  }

  documents.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.size - b.size;
  });

  return { root, foldersPresent: [...foldersPresent], foldersMissing: [...foldersMissing], documents };
}

/** List director subfolder names under Directors KYC (or Director KYC). */
export async function listDirectorSubfolders(plantRoot: string): Promise<string[]> {
  const root = await resolvePlantFolder(plantRoot);
  const candidates = ["Directors KYC", "Director KYC"];
  for (const name of candidates) {
    const dir = path.join(root, name);
    try {
      const st = await fs.stat(dir);
      if (!st.isDirectory()) continue;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      continue;
    }
  }
  return [];
}

/** Pick a balanced set of docs for Claude (max files / bytes). Prefer smaller files. */
export function selectDocsForAi(
  documents: ScannedDoc[],
  maxFiles = 8,
  maxBytes = 40 * 1024 * 1024,
): ScannedDoc[] {
  const priority = [
    "SPV KYC",
    "Directors KYC",
    "Director KYC",
    "EPC KYC",
    "DPR From EPC",
    "Land KYC",
    "Plant KYC",
    "Invoices",
    "Third Party Reports",
    "Misc",
    "Root",
  ];
  const byCat = new Map<string, ScannedDoc[]>();
  for (const d of documents) {
    const list = byCat.get(d.category) ?? [];
    list.push(d);
    byCat.set(d.category, list);
  }
  for (const [, list] of byCat) {
    list.sort((a, b) => a.size - b.size);
  }

  const picked: ScannedDoc[] = [];
  let bytes = 0;
  let added = true;
  while (added && picked.length < maxFiles && bytes < maxBytes) {
    added = false;
    for (const cat of priority) {
      const list = byCat.get(cat);
      if (!list?.length) continue;
      const next = list.shift()!;
      if (next.size > 60 * 1024 * 1024) continue;
      picked.push(next);
      bytes += Math.min(next.size, 2 * 1024 * 1024);
      added = true;
      if (picked.length >= maxFiles) break;
    }
  }
  return picked;
}
