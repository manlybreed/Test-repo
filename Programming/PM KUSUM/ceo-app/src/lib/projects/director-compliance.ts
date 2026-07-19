import type { DirectorRow } from "./director-section23";
import type { NamedDirector } from "./spv-section1";
import type { LandKycCheckResult } from "./land-kyc-check";

export type DirectorMatchFlag = {
  name: string;
  din?: string | null;
  source: "MCA" | "GST" | "DIRECTORS_KYC";
  issue:
    | "MISSING_FROM_DIRECTORS_KYC"
    | "MISSING_FROM_MCA_GST"
    | "GST_MCA_MISMATCH";
  detail?: string;
};

export type CibilFlag = {
  name: string;
  status: "ASK_FOR_CIBIL" | "RED_FLAG" | "OK";
  score?: number | null;
  detail: string;
};

export type LandFlag = {
  severity: "RED_FLAG" | "ASK";
  detail: string;
};

function normName(s: string | null | undefined): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normDin(s: string | null | undefined): string {
  const digits = (s || "").replace(/\D/g, "");
  return digits.length >= 6 ? digits : "";
}

export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const at = a.split(" ").filter(Boolean);
  const bt = b.split(" ").filter(Boolean);
  if (at.length >= 2 && bt.length >= 2) {
    const aFirst = at[0]!;
    const aLast = at[at.length - 1]!;
    const bFirst = bt[0]!;
    const bLast = bt[bt.length - 1]!;
    if (aFirst === bFirst && aLast === bLast) return true;
  }
  return a.includes(b) || b.includes(a);
}

function findInDirectors(
  party: NamedDirector,
  directors: DirectorRow[],
): boolean {
  const din = normDin(party.din);
  const name = normName(party.name);
  return directors.some((d) => {
    const dDin = normDin(d.dinOrPan);
    if (din && dDin && din === dDin) return true;
    return namesMatch(name, normName(d.name));
  });
}

function findInNamed(
  director: DirectorRow | NamedDirector,
  parties: NamedDirector[],
): boolean {
  const din = normDin(
    "dinOrPan" in director
      ? director.dinOrPan
      : "din" in director
        ? director.din
        : null,
  );
  const name = normName(director.name);
  return parties.some((p) => {
    const pDin = normDin(p.din);
    if (din && pDin && din === pDin) return true;
    return namesMatch(name, normName(p.name));
  });
}

/** GST vs MCA director list cross-check (no AI). */
export function buildGstMcaMismatchFlags(
  gstDirectors?: NamedDirector[] | null,
  mcaDirectors?: NamedDirector[] | null,
): DirectorMatchFlag[] {
  const gst = gstDirectors ?? [];
  const mca = mcaDirectors ?? [];
  if (!gst.length || !mca.length) return [];

  const flags: DirectorMatchFlag[] = [];
  const seen = new Set<string>();

  for (const g of gst) {
    if (!g.name?.trim()) continue;
    if (findInNamed(g, mca)) continue;
    const key = `gst-mca:${normDin(g.din) || normName(g.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({
      name: g.name,
      din: g.din ?? null,
      source: "GST",
      issue: "GST_MCA_MISMATCH",
      detail: `${g.name} appears on GST but not on MCA`,
    });
  }

  for (const m of mca) {
    if (!m.name?.trim()) continue;
    if (findInNamed(m, gst)) continue;
    const key = `mca-gst:${normDin(m.din) || normName(m.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({
      name: m.name,
      din: m.din ?? null,
      source: "MCA",
      issue: "GST_MCA_MISMATCH",
      detail: `${m.name} appears on MCA but not on GST`,
    });
  }

  return flags;
}

/** Deterministic GST/MCA vs Directors KYC + GST↔MCA cross-check (no AI). */
export function buildDirectorMatchFlags(opts: {
  gstDirectors?: NamedDirector[] | null;
  mcaDirectors?: NamedDirector[] | null;
  directors?: DirectorRow[] | null;
}): DirectorMatchFlag[] {
  const flags: DirectorMatchFlag[] = [
    ...buildGstMcaMismatchFlags(opts.gstDirectors, opts.mcaDirectors),
  ];
  const directors = opts.directors ?? [];
  const gst = opts.gstDirectors ?? [];
  const mca = opts.mcaDirectors ?? [];
  const spvParties = [...gst, ...mca];

  const seenMissing = new Set<string>();
  for (const source of [
    ...gst.map((p) => ({ ...p, source: "GST" as const })),
    ...mca.map((p) => ({ ...p, source: "MCA" as const })),
  ]) {
    if (!source.name?.trim()) continue;
    if (findInDirectors(source, directors)) continue;
    const key = `miss-kyc:${normDin(source.din) || normName(source.name)}`;
    if (seenMissing.has(key)) continue;
    seenMissing.add(key);
    flags.push({
      name: source.name,
      din: source.din ?? null,
      source: source.source,
      issue: "MISSING_FROM_DIRECTORS_KYC",
      detail: `${source.name} on ${source.source} missing from Directors KYC`,
    });
  }

  if (spvParties.length > 0) {
    for (const d of directors) {
      if (!d.name?.trim()) continue;
      if (findInNamed(d, spvParties)) continue;
      const key = `miss-spv:${normDin(d.dinOrPan) || normName(d.name)}`;
      if (seenMissing.has(key)) continue;
      seenMissing.add(key);
      flags.push({
        name: d.name,
        din: d.dinOrPan ?? null,
        source: "DIRECTORS_KYC",
        issue: "MISSING_FROM_MCA_GST",
        detail: `${d.name} in Directors KYC missing from MCA/GST`,
      });
    }
  }

  return flags;
}

const CIBIL_OK = 725;

export function buildCibilFlags(
  directors: Array<
    DirectorRow & {
      cibilScore?: string | number | null;
      cibilDocumentFound?: boolean | null;
      cibilNameOnDocument?: string | null;
      cibilNameMatches?: boolean | null;
    }
  >,
): CibilFlag[] {
  return directors.map((d) => {
    const name = d.name || "Unknown director";
    const found = d.cibilDocumentFound === true;
    const raw = d.cibilScore;
    const score =
      typeof raw === "number"
        ? raw
        : raw != null && String(raw).trim()
          ? Number(String(raw).replace(/,/g, "").trim())
          : null;

    const nameOnDoc = (d.cibilNameOnDocument || "").trim();
    const nameOk =
      d.cibilNameMatches === true ||
      (d.cibilNameMatches == null &&
        nameOnDoc &&
        namesMatch(normName(name), normName(nameOnDoc)));

    if (!found || score == null || !Number.isFinite(score)) {
      return {
        name,
        status: "ASK_FOR_CIBIL" as const,
        score: Number.isFinite(score as number) ? (score as number) : null,
        detail: found
          ? "CIBIL document found but score not readable — ask for clear CIBIL report."
          : "No CIBIL document for this director — ask for CIBIL.",
      };
    }

    // Name on CIBIL must match this director
    if (found && (d.cibilNameMatches === false || (nameOnDoc && !nameOk))) {
      return {
        name,
        status: "RED_FLAG" as const,
        score,
        detail: `CIBIL name mismatch — report says “${nameOnDoc || "?"}” but director is “${name}”.`,
      };
    }
    if (found && !nameOnDoc && d.cibilNameMatches !== true) {
      return {
        name,
        status: "RED_FLAG" as const,
        score,
        detail: `CIBIL report found but borrower/director name on document not confirmed for ${name}.`,
      };
    }

    if (score < CIBIL_OK) {
      return {
        name,
        status: "RED_FLAG" as const,
        score,
        detail: `CIBIL ${score} is below ${CIBIL_OK}.`,
      };
    }
    return {
      name,
      status: "OK" as const,
      score,
      detail: `CIBIL ${score} OK — name on report matches ${name}.`,
    };
  });
}

/** Surface khasra / land mismatches as compliance red flags. */
export function buildLandFlags(
  land?: LandKycCheckResult | null,
): LandFlag[] {
  if (!land) return [];
  const flags: LandFlag[] = [];
  for (const m of land.mismatches ?? []) {
    flags.push({
      severity: "RED_FLAG",
      detail: `Khasra / land mismatch (jamabandi vs PPA vs lease): ${m}`,
    });
  }
  for (const t of land.leaseTypos ?? []) {
    flags.push({
      severity: "RED_FLAG",
      detail: `Lease deed typo vs PPA/jamabandi: ${t}`,
    });
  }
  for (const code of land.askForDocuments ?? []) {
    flags.push({
      severity: "ASK",
      detail: `Ask for missing Land KYC doc: ${code}`,
    });
  }
  if (
    land.jamabandi &&
    !land.jamabandi.found &&
    !(land.askForDocuments || []).includes("LAND_JAMABANDI")
  ) {
    flags.push({ severity: "ASK", detail: "Ask for jamabandi in Land KYC." });
  }
  if (
    land.leaseDeed &&
    !land.leaseDeed.found &&
    !(land.askForDocuments || []).includes("LAND_LEASE")
  ) {
    flags.push({
      severity: "ASK",
      detail: "Ask for registered lease deed in Land KYC.",
    });
  }
  return flags;
}

export type ComplianceBundle = {
  directorMatch: DirectorMatchFlag[];
  cibilFlags: CibilFlag[];
  landFlags: LandFlag[];
  askForDocuments: string[];
  landMatch?: boolean | null;
  mcaCapital?: {
    authorizedCapital?: string | null;
    paidUpCapital?: string | null;
  } | null;
};
