import path from "path";
import type { ScannedDoc } from "./scan-folder";

export type MatchCatalogRow = {
  id: string;
  code: string;
  label: string;
  folderHint: string;
  matchHints: string[];
  scope: string;
};

export type MatchRequirement = {
  id: string;
  catalogId: string;
  partyId: string | null;
  partyFolderName?: string | null;
  partyName?: string | null;
  catalog: MatchCatalogRow;
};

export type MatchHit = {
  requirementId: string;
  fileRelativePath: string;
  score: number;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function categoryMatchesHint(category: string, folderHint: string): boolean {
  const c = norm(category);
  const h = norm(folderHint);
  if (c === h) return true;
  // Directors KYC / Director KYC
  if (h.includes("director") && c.includes("director")) return true;
  return false;
}

function scoreFileAgainstCatalog(
  doc: ScannedDoc,
  catalog: MatchCatalogRow,
  opts: { plantShort?: string | null; partyName?: string | null },
): number {
  if (!categoryMatchesHint(doc.category, catalog.folderHint) && catalog.scope === "PLANT") {
    // still allow weak match if filename is very strong
  } else if (
    catalog.scope === "PARTY" &&
    !categoryMatchesHint(doc.category, catalog.folderHint)
  ) {
    return 0;
  }

  const base = path.basename(doc.absolutePath, doc.ext);
  const n = norm(base);
  let score = 0;

  if (categoryMatchesHint(doc.category, catalog.folderHint)) score += 40;

  for (const hint of catalog.matchHints) {
    const h = norm(hint);
    if (!h) continue;
    if (n.includes(h)) score += h.length >= 4 ? 35 : 20;
  }

  const label = norm(catalog.label);
  if (label && n.includes(label)) score += 25;

  if (opts.plantShort) {
    const ps = norm(opts.plantShort);
    if (ps && n.startsWith(ps)) score += 15;
  }

  if (opts.partyName) {
    const pn = norm(opts.partyName);
    if (pn && n.includes(pn.split(" ")[0] || pn)) score += 20;
    if (pn && n.includes(pn)) score += 15;
  }

  // Party docs must live under that director's subfolder when known
  if (catalog.scope === "PARTY" && opts.partyName) {
    const rel = norm(doc.relativePath);
    const folder = norm(opts.partyName);
    if (folder && !rel.includes(folder) && !rel.includes(norm(opts.partyName.replace(/\s+/g, " ")))) {
      // try first+last token
      const tokens = folder.split(" ").filter(Boolean);
      const ok = tokens.some((t) => t.length > 2 && rel.includes(t));
      if (!ok) score = Math.min(score, 20);
    }
  }

  return score;
}

const AUTO_THRESHOLD = 55;

/**
 * Greedy 1:1 matching — highest unique scores first.
 * Returns only hits at/above AUTO_THRESHOLD.
 */
export function matchRequirementsToFiles(
  requirements: MatchRequirement[],
  documents: ScannedDoc[],
  opts: { plantShort?: string | null },
): MatchHit[] {
  type Cand = {
    requirementId: string;
    fileRelativePath: string;
    score: number;
  };
  const cands: Cand[] = [];

  for (const req of requirements) {
    for (const doc of documents) {
      if (req.partyFolderName) {
        const rel = doc.relativePath.replace(/\\/g, "/");
        if (!rel.toLowerCase().includes(req.partyFolderName.toLowerCase())) {
          continue;
        }
      }
      const score = scoreFileAgainstCatalog(doc, req.catalog, {
        plantShort: opts.plantShort,
        partyName: req.partyName,
      });
      if (score >= AUTO_THRESHOLD) {
        cands.push({
          requirementId: req.id,
          fileRelativePath: doc.relativePath,
          score,
        });
      }
    }
  }

  cands.sort((a, b) => b.score - a.score);
  const usedReqs = new Set<string>();
  const usedFiles = new Set<string>();
  const hits: MatchHit[] = [];

  for (const c of cands) {
    if (usedReqs.has(c.requirementId) || usedFiles.has(c.fileRelativePath)) continue;
    usedReqs.add(c.requirementId);
    usedFiles.add(c.fileRelativePath);
    hits.push(c);
  }
  return hits;
}
