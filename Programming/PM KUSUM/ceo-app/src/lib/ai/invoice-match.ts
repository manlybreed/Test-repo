import { prisma } from "@/lib/prisma";

export type ClientMatch = {
  clientId: string;
  name: string;
  score: number;
  gstin?: string | null;
  stateCode?: string | null;
  address?: string | null;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreName(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = new Set([...ta, ...tb]).size;
  return union ? inter / union : 0;
}

/** Fuzzy match buyer to Client master; optional GSTIN exact boost. */
export async function matchBuyerToClient(input: {
  buyerName: string;
  buyerGstin?: string | null;
}): Promise<ClientMatch[]> {
  const clients = await prisma.client.findMany({
    select: {
      id: true,
      name: true,
      gstin: true,
      stateCode: true,
      addressLine1: true,
      city: true,
      state: true,
    },
  });

  const gstin = input.buyerGstin?.trim().toUpperCase();
  const scored: ClientMatch[] = [];

  for (const c of clients) {
    let score = scoreName(input.buyerName, c.name);
    if (gstin && c.gstin?.toUpperCase() === gstin) score = Math.max(score, 0.98);
    if (score >= 0.45) {
      scored.push({
        clientId: c.id,
        name: c.name,
        score,
        gstin: c.gstin,
        stateCode: c.stateCode,
        address: [c.addressLine1, c.city, c.state].filter(Boolean).join(", "),
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, 5);
}

export async function suggestAgreementForClient(clientId: string) {
  const agreements = await prisma.agreement.findMany({
    where: { clientId },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      id: true,
      clientName: true,
      tokenFeePerPlant: true,
      successFeePct: true,
      successFeeFlat: true,
      plantCount: true,
      status: true,
    },
  });
  return agreements;
}

export function feeLinesFromAgreement(a: {
  tokenFeePerPlant: number;
  plantCount: number;
  successFeePct: number;
  successFeeFlat: number | null;
}): { description: string; rate: number; hsn: string; quantity: number }[] {
  const lines = [
    {
      description: "Engagement Token - PM KUSUM",
      rate: a.tokenFeePerPlant,
      hsn: "998313",
      quantity: a.plantCount || 1,
    },
  ];
  if (a.successFeeFlat != null && a.successFeeFlat > 0) {
    lines.push({
      description: "Success Fee - PM KUSUM",
      rate: a.successFeeFlat,
      hsn: "998313",
      quantity: 1,
    });
  }
  return lines;
}
