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

function landLocation(land: Record<string, unknown> | null): {
  tehsil: string | null;
  district: string | null;
  village: string | null;
} {
  if (!land) return { tehsil: null, district: null, village: null };
  const parcels = Array.isArray(land.leasedParcels) ? land.leasedParcels : [];
  const first = asObj(parcels[0]);
  const jamabandi = asObj(land.jamabandi);
  const jamParcels = Array.isArray(jamabandi?.parcels) ? jamabandi!.parcels : [];
  const jamFirst = asObj(jamParcels[0]);
  const lease = asObj(land.leaseDeed);
  const leaseParcels = Array.isArray(lease?.parcels) ? lease!.parcels : [];
  const leaseFirst = asObj(leaseParcels[0]);

  return {
    tehsil:
      str(first?.tehsil) ||
      str(jamFirst?.tehsil) ||
      str(leaseFirst?.tehsil) ||
      null,
    district:
      str(first?.district) ||
      str(jamFirst?.district) ||
      str(leaseFirst?.district) ||
      null,
    village:
      str(first?.village) ||
      str(jamFirst?.village) ||
      str(leaseFirst?.village) ||
      null,
  };
}

function plantKycFields(raw: Record<string, unknown>): Record<string, unknown> | null {
  const outer = asObj(raw.plantKyc);
  if (!outer) return null;
  return asObj(outer.plantKyc) || outer;
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
  const loc = landLocation(land);
  const pk = plantKycFields(parsed);

  const capacity =
    plant.capacityMw ||
    str(s4?.capacityAcMw) ||
    str(s4?.capacityDcMwp) ||
    str(parsed.capacityMw) ||
    null;

  const tehsil =
    plant.tehsil ||
    loc.tehsil ||
    str(s4?.tehsil) ||
    null;

  const district =
    plant.district ||
    loc.district ||
    str(s4?.district) ||
    str(s1?.district) ||
    null;

  const loaNumber = str(pk?.loaNumber);
  const dprTitle = str(s4?.dprProjectCost) ? "DPR on file" : null;
  const dprName =
    plant.dprName ||
    loaNumber ||
    str(s4?.loaRef) ||
    str(parsed.dprName) ||
    dprTitle;

  const epcName =
    plant.epcName ||
    str(epc?.name) ||
    str(epc?.legalName) ||
    str(parsed.epcName) ||
    null;

  const tariff =
    plant.tariff ||
    str(pk?.tariff) ||
    str(s4?.tariff) ||
    null;

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

/** Columns to write when AI fills sections (only fills empty DB fields). */
export function profilePatchFromSections(opts: {
  section1?: Record<string, unknown> | null;
  section4?: Record<string, unknown> | null;
  land?: Record<string, unknown> | null;
  plantKyc?: Record<string, unknown> | null;
  epc?: Record<string, unknown> | null;
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
  epcName: string;
  tariff: string;
  bankName: string;
}> {
  const s1 = opts.section1 || {};
  const s4 = opts.section4 || {};
  const pk = opts.plantKyc || {};
  const epc = opts.epc || {};
  const loc = landLocation(opts.land || null);

  const pick = (cur: unknown, next: unknown) => {
    // DB/AI values may be numbers — never call .trim on a non-string
    if (str(cur)) return undefined;
    const v = str(next);
    return v || undefined;
  };

  const loaNumber = str(pk.loaNumber);
  const dprLabel = loaNumber || str(s4.loaRef) || null;

  return {
    capacityMw: pick(opts.existing.capacityMw, s4.capacityAcMw || s4.capacityDcMwp),
    tehsil: pick(opts.existing.tehsil, loc.tehsil || s4.tehsil),
    district: pick(opts.existing.district, loc.district || s4.district || s1.district),
    // Prefer LOA number as table label; do not invent "LOA …" prefix spam
    dprName: pick(opts.existing.dprName, dprLabel),
    epcName: pick(
      opts.existing.epcName,
      epc.name || epc.legalName || null,
    ),
    tariff: pick(opts.existing.tariff, pk.tariff || s4.tariff),
    bankName: pick(opts.existing.bankName, s1.bankName),
  };
}
