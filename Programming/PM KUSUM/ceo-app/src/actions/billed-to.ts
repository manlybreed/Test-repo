"use server";

import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import {
  normalizeBilledToName,
  displayBilledToName,
  scoreBilledToMatch,
  type BilledToMatchKind,
} from "@/lib/billed-to";

export type BilledToCandidate = {
  partyId: string;
  canonicalName: string;
  sampleAlias: string;
  kind: BilledToMatchKind;
  score: number;
  reason: string;
};

export type ResolveBilledToResult =
  | { status: "empty" }
  | {
      status: "matched";
      partyId: string;
      canonicalName: string;
      kind: "exact" | "auto";
    }
  | {
      status: "ambiguous";
      incoming: string;
      candidates: BilledToCandidate[];
    }
  | { status: "new"; incoming: string; normalized: string };

/** Find existing bill-to parties that may match this extracted name. */
export async function resolveBilledTo(
  rawName: string | null | undefined,
): Promise<ResolveBilledToResult> {
  await requireCeo();
  const incoming = (rawName || "").trim();
  if (!incoming) return { status: "empty" };

  const normalized = normalizeBilledToName(incoming);
  if (!normalized) return { status: "empty" };

  // Exact alias / party normalized hit
  const [aliasHit, partyHit] = await Promise.all([
    prisma.billedToAlias.findFirst({
      where: { normalized },
      include: { party: true },
    }),
    prisma.billedToParty.findUnique({ where: { normalized } }),
  ]);

  if (aliasHit?.party) {
    return {
      status: "matched",
      partyId: aliasHit.party.id,
      canonicalName: aliasHit.party.canonicalName,
      kind: "exact",
    };
  }
  if (partyHit) {
    return {
      status: "matched",
      partyId: partyHit.id,
      canonicalName: partyHit.canonicalName,
      kind: "exact",
    };
  }

  const parties = await prisma.billedToParty.findMany({
    include: { aliases: { take: 3, orderBy: { createdAt: "asc" } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const auto: BilledToCandidate[] = [];
  const ambiguous: BilledToCandidate[] = [];

  for (const p of parties) {
    const names = [p.canonicalName, p.normalized, ...p.aliases.map((a) => a.rawName)];
    let best: BilledToCandidate | null = null;
    for (const n of names) {
      const scored = scoreBilledToMatch(incoming, n);
      if (scored.kind === "none") continue;
      const cand: BilledToCandidate = {
        partyId: p.id,
        canonicalName: p.canonicalName,
        sampleAlias: n,
        kind: scored.kind,
        score: scored.score,
        reason: scored.reason,
      };
      if (!best || cand.score > best.score) best = cand;
    }
    if (!best) continue;
    if (best.kind === "exact" || best.kind === "auto") auto.push(best);
    else if (best.kind === "ambiguous") ambiguous.push(best);
  }

  auto.sort((a, b) => b.score - a.score);
  ambiguous.sort((a, b) => b.score - a.score);

  if (auto[0]) {
    return {
      status: "matched",
      partyId: auto[0].partyId,
      canonicalName: auto[0].canonicalName,
      kind: auto[0].kind === "exact" ? "exact" : "auto",
    };
  }

  if (ambiguous.length) {
    return {
      status: "ambiguous",
      incoming,
      candidates: ambiguous.slice(0, 5),
    };
  }

  return { status: "new", incoming, normalized };
}

/** Confirm incoming name is the same person as an existing party — add alias. */
export async function confirmBilledToSame(input: {
  partyId: string;
  rawName: string;
}): Promise<{ partyId: string; canonicalName: string }> {
  await requireCeo();
  const party = await prisma.billedToParty.findUniqueOrThrow({
    where: { id: input.partyId },
  });
  const normalized = normalizeBilledToName(input.rawName);
  if (normalized) {
    await prisma.billedToAlias.upsert({
      where: {
        partyId_normalized: { partyId: party.id, normalized },
      },
      create: {
        partyId: party.id,
        rawName: input.rawName.trim(),
        normalized,
      },
      update: { rawName: input.rawName.trim() },
    });
  }
  return { partyId: party.id, canonicalName: party.canonicalName };
}

/** Create a new bill-to party (user said "not the same" or first sighting). */
export async function createBilledToParty(rawName: string): Promise<{
  partyId: string;
  canonicalName: string;
}> {
  await requireCeo();
  const raw = rawName.trim();
  if (!raw) throw new Error("Billed-to name required");
  const normalized = normalizeBilledToName(raw);
  if (!normalized) throw new Error("Could not normalize billed-to name");
  // Store cleaned label (no MR / S/O …) for the database column
  const canonicalName = displayBilledToName(raw) || normalized;

  const existing = await prisma.billedToParty.findUnique({ where: { normalized } });
  if (existing) {
    // Repair older rows that still stored "… S/O …" as canonical
    if (/s\s*[./\\]?\s*o\b/i.test(existing.canonicalName) || /son\s+of/i.test(existing.canonicalName)) {
      await prisma.billedToParty.update({
        where: { id: existing.id },
        data: { canonicalName },
      });
    }
    await prisma.billedToAlias.upsert({
      where: { partyId_normalized: { partyId: existing.id, normalized } },
      create: { partyId: existing.id, rawName: raw, normalized },
      update: { rawName: raw },
    });
    const fresh = await prisma.billedToParty.findUniqueOrThrow({ where: { id: existing.id } });
    return { partyId: fresh.id, canonicalName: fresh.canonicalName };
  }

  const party = await prisma.billedToParty.create({
    data: {
      canonicalName,
      normalized,
      aliases: {
        create: { rawName: raw, normalized },
      },
    },
  });
  return { partyId: party.id, canonicalName: party.canonicalName };
}

/** Fix parties whose canonical name still includes S/O / Son of. */
export async function repairBilledToCanonicalNames(): Promise<number> {
  await requireCeo();
  const parties = await prisma.billedToParty.findMany();
  let fixed = 0;
  for (const p of parties) {
    if (!/s\s*[./\\]?\s*o\b/i.test(p.canonicalName) && !/son\s+of/i.test(p.canonicalName)) {
      continue;
    }
    const cleaned = displayBilledToName(p.canonicalName) || normalizeBilledToName(p.canonicalName);
    if (!cleaned || cleaned === p.canonicalName) continue;
    const normalized = normalizeBilledToName(cleaned);
    await prisma.billedToParty.update({
      where: { id: p.id },
      data: {
        canonicalName: cleaned,
        ...(normalized ? { normalized } : {}),
      },
    });
    fixed++;
  }
  return fixed;
}

/** Ensure party exists + alias for raw name; returns party id (auto path). */
export async function ensureBilledToParty(input: {
  rawName: string;
  partyId?: string | null;
}): Promise<string | null> {
  await requireCeo();
  const raw = input.rawName.trim();
  if (!raw) return null;

  if (input.partyId) {
    await confirmBilledToSame({ partyId: input.partyId, rawName: raw });
    return input.partyId;
  }

  const resolved = await resolveBilledTo(raw);
  if (resolved.status === "matched") {
    await confirmBilledToSame({
      partyId: resolved.partyId,
      rawName: raw,
    });
    return resolved.partyId;
  }

  const created = await createBilledToParty(raw);
  return created.partyId;
}
