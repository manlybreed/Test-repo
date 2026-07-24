/**
 * Phase R4 — RAG retrieval eval.
 *
 *   npm run eval:rag
 *
 * Runs the real `retrieveMail` pipeline against the golden set in
 * scripts/rag-golden.json and reports recall@10 + MRR, overall and per bucket.
 * The `paraphrase` bucket is the decision gate for R5 (hybrid pgvector): if it
 * clears the target after R1-R3, hybrid can be skipped.
 *
 * With ANTHROPIC_API_KEY set it exercises AI query-expansion + rerank; without,
 * it measures the pure FTS + lexical baseline (deterministic). The mode is
 * printed so results are interpreted correctly.
 */
import { config } from "dotenv";
import { readFileSync } from "fs";
import path from "path";
config({ path: ".env.local" });
config();

type ExpectClause = { fromContains?: string; subjectContains?: string };
type GoldenEntry = {
  query: string;
  expect?: ExpectClause[];
  expectEmpty?: boolean;
  expectEmptyOk?: boolean;
};
type Golden = { buckets: Record<string, GoldenEntry[]> };

const TARGET_RECALL = 0.7;

function clauseMatches(
  clause: ExpectClause,
  r: { subject: string; fromAddress: string },
): boolean {
  const subj = (r.subject || "").toLowerCase();
  const from = (r.fromAddress || "").toLowerCase();
  const subjOk = clause.subjectContains
    ? subj.includes(clause.subjectContains.toLowerCase())
    : true;
  const fromOk = clause.fromContains
    ? from.includes(clause.fromContains.toLowerCase())
    : true;
  // Require every provided field of the clause to match.
  return subjOk && fromOk;
}

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { retrieveMail } = await import("../src/lib/mail/ai/retrieve");

  const goldenPath = path.join(__dirname, "rag-golden.json");
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as Golden;

  const account = await prisma.mailAccount.findFirst();
  if (!account) {
    console.error("No mail account found — sync a mailbox first.");
    process.exit(1);
  }

  const aiMode = process.env.ANTHROPIC_API_KEY ? "AI expand+rerank" : "FTS-only baseline";
  console.log(`\nRAG eval — account ${account.address} — mode: ${aiMode}\n`);

  const perBucket: Record<
    string,
    { hits: number; total: number; rrSum: number }
  > = {};
  const failures: string[] = [];

  for (const [bucket, entries] of Object.entries(golden.buckets)) {
    perBucket[bucket] = { hits: 0, total: 0, rrSum: 0 };
    for (const entry of entries) {
      const results = await retrieveMail({
        accountId: account.id,
        query: entry.query,
        limit: 10,
      });

      // Edge entries assert emptiness / graceful handling.
      if (entry.expectEmpty) {
        const ok = results.length === 0;
        perBucket[bucket]!.total += 1;
        if (ok) perBucket[bucket]!.hits += 1;
        else failures.push(`[${bucket}] "${entry.query}" expected empty, got ${results.length}`);
        continue;
      }
      if (entry.expectEmptyOk) {
        // Just must not throw; always counts as handled.
        perBucket[bucket]!.total += 1;
        perBucket[bucket]!.hits += 1;
        continue;
      }

      perBucket[bucket]!.total += 1;
      let rank = 0;
      for (let i = 0; i < results.length; i++) {
        const hit = (entry.expect || []).some((c) => clauseMatches(c, results[i]!));
        if (hit) {
          rank = i + 1;
          break;
        }
      }
      if (rank > 0) {
        perBucket[bucket]!.hits += 1;
        perBucket[bucket]!.rrSum += 1 / rank;
      } else {
        failures.push(`[${bucket}] "${entry.query}" — no expected hit in top-${results.length}`);
      }
    }
  }

  let allHits = 0;
  let allTotal = 0;
  let allRr = 0;
  console.log("bucket         recall@10   MRR     (hits/total)");
  console.log("------         ---------   ---     -----------");
  for (const [bucket, s] of Object.entries(perBucket)) {
    allHits += s.hits;
    allTotal += s.total;
    allRr += s.rrSum;
    const recall = s.total ? s.hits / s.total : 0;
    const mrr = s.total ? s.rrSum / s.total : 0;
    console.log(
      `${bucket.padEnd(14)} ${recall.toFixed(2).padStart(6)}   ${mrr.toFixed(2).padStart(5)}     (${s.hits}/${s.total})`,
    );
  }
  const overallRecall = allTotal ? allHits / allTotal : 0;
  const overallMrr = allTotal ? allRr / allTotal : 0;
  console.log("------         ---------   ---     -----------");
  console.log(
    `${"OVERALL".padEnd(14)} ${overallRecall.toFixed(2).padStart(6)}   ${overallMrr.toFixed(2).padStart(5)}     (${allHits}/${allTotal})`,
  );

  const para = perBucket["paraphrase"];
  if (para) {
    const paraRecall = para.total ? para.hits / para.total : 0;
    console.log(
      `\nParaphrase slice (R5 gate): recall@10 = ${paraRecall.toFixed(2)} ` +
        `(target ${TARGET_RECALL}) → ${
          paraRecall >= TARGET_RECALL
            ? "clears the bar; hybrid pgvector NOT required yet"
            : "still missing; R5 hybrid pgvector is justified"
        }`,
    );
  }

  if (failures.length) {
    console.log("\nMisses:");
    for (const f of failures) console.log("  " + f);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
