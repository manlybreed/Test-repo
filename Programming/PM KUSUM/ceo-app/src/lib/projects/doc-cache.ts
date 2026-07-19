import fs from "fs/promises";
import type { ScannedDoc } from "./scan-folder";
import {
  docsToAiContent,
  type DocAttachResult,
} from "./doc-content";
import type Anthropic from "@anthropic-ai/sdk";

type ContentBlock =
  | Anthropic.ImageBlockParam
  | Anthropic.DocumentBlockParam
  | Anthropic.TextBlockParam;

export type AttachDocsFn = (
  docs: ScannedDoc[],
  opts?: {
    kindHint?: (doc: ScannedDoc) => string;
    maxCharsTotal?: number;
    maxCharsPerDoc?: number;
    maxBinaryBytesTotal?: number;
  },
) => Promise<{ content: ContentBlock[]; report: DocAttachResult[] }>;

type CacheEntry = {
  content: ContentBlock[];
  report: DocAttachResult[];
};

/**
 * Memoize docsToAiContent for one orchestrator run.
 * Keyed by absolutePath + mtime + size + kindHint + budget options.
 */
export function createDocAiCache(): AttachDocsFn & {
  stats: () => { hits: number; misses: number };
} {
  const cache = new Map<string, CacheEntry>();
  let hits = 0;
  let misses = 0;

  const attach: AttachDocsFn = async (docs, opts) => {
    const kindHint = opts?.kindHint;
    const parts: string[] = [];
    for (const doc of docs) {
      let mtime = doc.mtimeMs ?? 0;
      if (!mtime) {
        try {
          const st = await fs.stat(doc.absolutePath);
          mtime = st.mtimeMs;
        } catch {
          mtime = 0;
        }
      }
      const hint = kindHint?.(doc) || "";
      parts.push(`${doc.absolutePath}|${mtime}|${doc.size}|${hint}`);
    }
    const key = [
      parts.sort().join(";"),
      opts?.maxCharsTotal ?? "",
      opts?.maxCharsPerDoc ?? "",
      opts?.maxBinaryBytesTotal ?? "",
    ].join("::");

    const cached = cache.get(key);
    if (cached) {
      hits += 1;
      return {
        content: cached.content.map((b) => ({ ...b })),
        report: cached.report.map((r) => ({ ...r })),
      };
    }

    misses += 1;
    const result = await docsToAiContent(docs, opts);
    cache.set(key, {
      content: result.content,
      report: result.report,
    });
    return result;
  };

  return Object.assign(attach, {
    stats: () => ({ hits, misses }),
  });
}
