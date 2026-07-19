/** Standard KYC subfolders under every plant pack (Solarseed layout). */
export const PLANT_SUBFOLDERS = [
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

export type CatalogSeed = {
  code: string;
  docGroup: string;
  label: string;
  description?: string;
  scope: "PLANT" | "PARTY";
  required?: boolean;
  folderHint: string;
  matchHints: string[];
  namePattern?: string;
  sortOrder: number;
};

/** Checklist template — seeded into DocTypeCatalog (not Notion). */
export const DOC_CATALOG_SEED: CatalogSeed[] = [
  // SPV
  { code: "SPV_COI", docGroup: "SPV", label: "COI", description: "Certificate of Incorporation", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["coi", "certificate of incorporation", "incorporation"], sortOrder: 10 },
  { code: "SPV_AOA", docGroup: "SPV", label: "AOA", description: "Articles of Association", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["aoa", "articles of association"], sortOrder: 20 },
  { code: "SPV_MOA", docGroup: "SPV", label: "MOA", description: "Memorandum of Association", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["moa", "memorandum"], sortOrder: 30 },
  { code: "SPV_MCA", docGroup: "SPV", label: "MCA", description: "MCA / company master data", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["mca"], sortOrder: 35 },
  { code: "SPV_DIN", docGroup: "SPV", label: "DIN of Directors", description: "DIN No. of Directors", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["din"], sortOrder: 40 },
  { code: "SPV_PAN", docGroup: "SPV", label: "Pan Card", description: "Company PAN", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["pan"], sortOrder: 50 },
  { code: "SPV_TAN", docGroup: "SPV", label: "TAN", description: "TAN", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["tan"], sortOrder: 60 },
  { code: "SPV_GST", docGroup: "SPV", label: "GST Registration", description: "GST Registration Certificate", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["gst"], sortOrder: 70 },
  { code: "SPV_UDYAM", docGroup: "SPV", label: "Udyam Registration", description: "Udyam Registration Certificate", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["udyam"], sortOrder: 80 },
  { code: "SPV_BOARD_RES", docGroup: "SPV", label: "Board Resolution", description: "Application / Board Resolution", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["board resolution", "board"], sortOrder: 90 },
  { code: "SPV_BANK", docGroup: "SPV", label: "Bank Statement", description: "Company bank statement", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["bank statement", "bank"], sortOrder: 95 },
  { code: "SPV_PROFILE", docGroup: "SPV", label: "Company Profile", description: "Company Profile and Objectives", scope: "PLANT", folderHint: "SPV KYC", matchHints: ["company profile", "profile"], sortOrder: 100 },

  // Directors (per party)
  { code: "DIR_AADHAAR", docGroup: "DIRECTORS", label: "Adhar Card", description: "Aadhaar", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["adhar", "aadhaar", "aadhar"], namePattern: "{partyName}-{label}", sortOrder: 110 },
  { code: "DIR_PASSPORT", docGroup: "DIRECTORS", label: "Passport", description: "Passport / Passport Undertaking", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["passport"], namePattern: "{partyName}-{label}", sortOrder: 120 },
  { code: "DIR_PAN", docGroup: "DIRECTORS", label: "Pan Card", description: "PAN", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["pan"], namePattern: "{partyName}-{label}", sortOrder: 130 },
  { code: "DIR_BANK", docGroup: "DIRECTORS", label: "Bank Statement", description: "Bank Statements", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["bank"], namePattern: "{partyName}-{label}", sortOrder: 140 },
  { code: "DIR_PHOTO", docGroup: "DIRECTORS", label: "Photo", description: "Photo", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["photo"], namePattern: "{partyName}-{label}", sortOrder: 150 },
  { code: "DIR_NETWORTH", docGroup: "DIRECTORS", label: "Net Worth Certificate", description: "Net Worth Certificate for last 1 year", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["net worth", "networth"], namePattern: "{partyName}-{label}", sortOrder: 160 },
  { code: "DIR_ITR", docGroup: "DIRECTORS", label: "ITR & Computation", description: "ITR, COMPUTATION for 3 years", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["itr", "computation"], namePattern: "{partyName}-{label}", sortOrder: 170 },
  { code: "DIR_PROFILE", docGroup: "DIRECTORS", label: "Director Profile", description: "Promoters' / Director Profile", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["director profile", "profile"], namePattern: "{partyName}-{label}", sortOrder: 180 },
  { code: "DIR_CIBIL", docGroup: "DIRECTORS", label: "CIBIL Report", description: "CIBIL / credit score report", scope: "PARTY", folderHint: "Directors KYC", matchHints: ["cibil", "credit score", "credit report"], namePattern: "{partyName}-{label}", sortOrder: 185 },

  // Plant KYC
  { code: "PLANT_LOA", docGroup: "PLANT", label: "LOA", description: "Letter of Award", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["loa", "letter of award"], sortOrder: 200 },
  { code: "PLANT_PPA", docGroup: "PLANT", label: "PPA", description: "Power Purchase Agreement", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["ppa", "power purchase"], sortOrder: 210 },
  { code: "PLANT_SPV_APPROVAL", docGroup: "PLANT", label: "SPV Approval", description: "SPV approval Letter", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["spv approval", "approval"], sortOrder: 220 },
  { code: "PLANT_BRIEF", docGroup: "PLANT", label: "Project Brief", description: "Brief Profile of the Project", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["brief", "project profile"], sortOrder: 230 },
  { code: "PLANT_PBG", docGroup: "PLANT", label: "PBG", description: "Details of PBG submitted as per article 2.5 of PPA", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["pbg"], sortOrder: 240 },
  { code: "PLANT_TECH_SANCTION", docGroup: "PLANT", label: "Technical Sanction", description: "Technical Sanction", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["technical sanction", "sanction"], sortOrder: 250 },
  { code: "PLANT_IRREVOCABLE", docGroup: "PLANT", label: "Irrevocable Letter", description: "Irrevocable letter as per article 3 of PPA", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["irrevocable"], sortOrder: 260 },
  { code: "PLANT_RRECL", docGroup: "PLANT", label: "RRECL Project Registration", description: "RRECL Project registration", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["rrecl", "project registration"], sortOrder: 270 },
  { code: "PLANT_GEO", docGroup: "PLANT", label: "Plant Geo Tag Photos", description: "Plant geo-tag photos", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["geo", "geotag"], sortOrder: 275 },
  { code: "PLANT_COMPLIANCE", docGroup: "PLANT", label: "PPA Art 4.1.1 Compliance", description: "Compliance Status of obligations mentioned in article 4.1.1 of PPA", scope: "PLANT", folderHint: "Plant KYC", matchHints: ["4.1.1", "compliance"], sortOrder: 280 },
  { code: "PLANT_BOARD_LEASE", docGroup: "PLANT", label: "Board Resolution for Land", description: "Board resolution for Lease Deed, PPA etc.", scope: "PLANT", folderHint: "Misc", matchHints: ["board resolution for land", "lease"], sortOrder: 290 },

  // Land
  { code: "LAND_JAMABANDI", docGroup: "LAND", label: "Jamabandi", description: "Jamabandi / land records", scope: "PLANT", folderHint: "Land KYC", matchHints: ["jamabandi", "jama"], sortOrder: 300 },
  { code: "LAND_LEASE", docGroup: "LAND", label: "Lease Deed", description: "Registered lease deed", scope: "PLANT", folderHint: "Land KYC", matchHints: ["lease"], sortOrder: 310 },
  { code: "LAND_TEHSIL_NOC", docGroup: "LAND", label: "Tehsil NOC", description: "Tehsil NOC", scope: "PLANT", folderHint: "Land KYC", matchHints: ["tehsil", "noc"], sortOrder: 320 },

  // DPR
  { code: "DPR_MAIN", docGroup: "DPR", label: "DPR", description: "Detailed Project Report", scope: "PLANT", folderHint: "DPR From EPC", matchHints: ["dpr"], sortOrder: 400 },
  { code: "DPR_EPC_OM", docGroup: "DPR", label: "EPC and O&M Agreement", description: "EPC and O&M Agreement", scope: "PLANT", folderHint: "DPR From EPC", matchHints: ["epc", "o&m", "om agreement"], sortOrder: 410 },

  // Third party
  { code: "TP_LEI", docGroup: "THIRD_PARTY", label: "LEI", description: "LEI report", scope: "PLANT", folderHint: "Third Party Reports", matchHints: ["lei"], sortOrder: 500 },
  { code: "TP_ROC", docGroup: "THIRD_PARTY", label: "ROC Search Report", description: "ROC Search Report", scope: "PLANT", folderHint: "Third Party Reports", matchHints: ["roc"], sortOrder: 510 },
];

export function buildDocFileName(opts: {
  pattern: string;
  plantShort: string;
  partyName?: string | null;
  label: string;
  ext: string;
}): string {
  const base = opts.pattern
    .replace(/\{plantShort\}/gi, opts.plantShort.trim())
    .replace(/\{partyName\}/gi, (opts.partyName || "").trim())
    .replace(/\{label\}/gi, opts.label.trim())
    .replace(/\{docLabel\}/gi, opts.label.trim());
  const ext = opts.ext.startsWith(".") ? opts.ext : `.${opts.ext}`;
  return `${base}${ext}`;
}

/** Guess short prefix from folder name: "SOLARSEED AGRI TECH PRIVATE LIMITED" → "Solarseed Agri" */
export function derivePlantShort(legalName: string): string {
  const cleaned = legalName
    .replace(/\b(private|limited|pvt\.?|ltd\.?|llp|opc)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) return legalName.slice(0, 20);
  const take = parts.slice(0, Math.min(2, parts.length));
  return take
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
