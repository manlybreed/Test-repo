/** Portfolio fields shown on the plants table. */
export type PlantProfile = {
  capacityMw: string | null;
  tehsil: string | null;
  district: string | null;
  dprName: string | null;
  epcName: string | null;
  tariff: string | null;
  bankName: string | null;
  activeStatus: "ACTIVE" | "INACTIVE";
};

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function nestSection(raw: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const outer = asObj(raw[key]);
  if (!outer) return null;
  // AI saves either { section4: { ...fields } } or flat fields
  return asObj(outer[key]) || asObj(outer.section4) || asObj(outer.section1) || outer;
}

/** Prefer stored columns; fall back to values parsed from rawExtract JSON. */
export function resolvePlantProfile(plant: {
  capacityMw?: string | null;
  tehsil?: string | null;
  district?: string | null;
  dprName?: string | null;
  epcName?: string | null;
  tariff?: string | null;
  bankName?: string | null;
  activeStatus?: string | null;
  rawExtract?: string | null;
}): PlantProfile {
  let parsed: Record<string, unknown> = {};
  if (plant.rawExtract) {
    try {
      parsed = asObj(JSON.parse(plant.rawExtract)) || {};
    } catch {
      parsed = {};
    }
  }

  const s1 = nestSection(parsed, "section1");
  const s4 = nestSection(parsed, "section4");
  const epc = asObj(parsed.epc);
  const land = asObj(parsed.land);
  const landLease = asObj(land?.leaseDeed) || asObj(land?.jamabandi);

  const capacity =
    plant.capacityMw ||
    str(s4?.capacityAcMw) ||
    str(s4?.capacityDcMwp) ||
    str(parsed.capacityMw) ||
    null;

  const tehsil =
    plant.tehsil ||
    str(s4?.tehsil) ||
    str(landLease?.tehsil) ||
    null;

  const district =
    plant.district ||
    str(s4?.district) ||
    str(s1?.district) ||
    str(landLease?.district) ||
    null;

  const dprName =
    plant.dprName ||
    str(s4?.loaRef) ||
    str(parsed.dprName) ||
    (s4 ? "DPR on file" : null);

  const epcName =
    plant.epcName ||
    str(epc?.name) ||
    str(epc?.legalName) ||
    str(parsed.epcName) ||
    null;

  const tariff = plant.tariff || str(s4?.tariff) || null;

  const bankName =
    plant.bankName ||
    str(s1?.bankName) ||
    str(parsed.bankName) ||
    null;

  const activeStatus =
    plant.activeStatus === "INACTIVE" ? "INACTIVE" : "ACTIVE";

  return {
    capacityMw: capacity,
    tehsil,
    district,
    dprName,
    epcName,
    tariff,
    bankName,
    activeStatus,
  };
}

/** Columns to write when AI fills Section 1 / 4 (only fills empty DB fields unless force). */
export function profilePatchFromSections(opts: {
  section1?: Record<string, unknown> | null;
  section4?: Record<string, unknown> | null;
  existing: {
    capacityMw?: string | null;
    tehsil?: string | null;
    district?: string | null;
    dprName?: string | null;
    epcName?: string | null;
    tariff?: string | null;
    bankName?: string | null;
  };
}): Partial<{
  capacityMw: string;
  tehsil: string;
  district: string;
  dprName: string;
  tariff: string;
  bankName: string;
}> {
  const s1 = opts.section1 || {};
  const s4 = opts.section4 || {};
  const pick = (cur: string | null | undefined, next: unknown) => {
    if (cur?.trim()) return undefined;
    const v = str(next);
    return v || undefined;
  };

  return {
    capacityMw: pick(opts.existing.capacityMw, s4.capacityAcMw || s4.capacityDcMwp),
    tehsil: pick(opts.existing.tehsil, s4.tehsil),
    district: pick(opts.existing.district, s4.district || s1.district),
    dprName: pick(opts.existing.dprName, s4.loaRef ? `LOA ${s4.loaRef}` : null),
    tariff: pick(opts.existing.tariff, s4.tariff),
    bankName: pick(opts.existing.bankName, s1.bankName),
  };
}
