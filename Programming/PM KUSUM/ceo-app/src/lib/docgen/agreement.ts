import fs from "fs/promises";
import path from "path";

export type AgreementInput = {
  clientName: string;
  clientAddress?: string | null;
  clientGstin?: string | null;
  clientPan?: string | null;
  clientEmail?: string | null;
  clientMobile?: string | null;
  spvName?: string | null;
  plantCount?: number;
  tokenFeePerPlant?: number;
  successFeePct?: number;
  designatedLender?: string | null;
  loanType?: string | null;
  interestMin?: string | null;
  interestMax?: string | null;
  minLoan?: string | null;
  maxLoan?: string | null;
  tenure?: string | null;
  moratorium?: string | null;
  repaymentSchedule?: string | null;
  collateral?: string | null;
  plantCapacityAC?: string | null;
  plantCapacityDC?: string | null;
  tariff?: string | null;
  dprAmount?: string | null;
  effectiveDate?: Date;
};

/**
 * OOXML frequently splits a single "visual" string across multiple <w:r><w:t>
 * elements for formatting reasons (bold, italic runs, proofing marks, etc.).
 *
 * This function works at the paragraph level:
 *  1. For each <w:p>, collect the text of all runs.
 *  2. If the concatenated text contains `find`, build a replacement paragraph
 *     where the first run receives the replaced text and all subsequent runs
 *     are emptied (preserving the rest of the document structure / formatting).
 */
function xmlReplaceParagraphLevel(
  xml: string,
  find: string,
  replace: string,
): string {
  // Match every <w:p>...</w:p> block (non-greedy, single-line mode)
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    // Collect text from all <w:t...> elements inside this paragraph
    const tMatches = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
    if (!tMatches.length) return para;

    const combined = tMatches.map((m) => m[1]).join("");
    if (!combined.includes(find)) return para; // nothing to do

    const replaced = combined.split(find).join(replace);

    // Put the full replaced text into the first <w:t> run and blank the rest
    let first = true;
    return para.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (_, attrs, _oldText) => {
      if (first) {
        first = false;
        // Preserve xml:space="preserve" if needed
        const space = replaced.startsWith(" ") || replaced.endsWith(" ")
          ? ` xml:space="preserve"`
          : "";
        return `<w:t${attrs}${space}>${xmlEscape(replaced)}</w:t>`;
      }
      return `<w:t${attrs}></w:t>`;
    });
  });
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Simple whole-string replace — works when text is in one run */
function xmlReplace(xml: string, find: string, replace: string): string {
  return xml.split(find).join(replace);
}

function formatDate(d: Date): { day: string; month: string; year: string } {
  return {
    day: String(d.getDate()),
    month: d.toLocaleDateString("en-IN", { month: "long" }),
    year: String(d.getFullYear()),
  };
}

export async function renderAgreementDocx(data: AgreementInput): Promise<Buffer> {
  const templatePath = path.join(
    process.cwd(),
    "templates",
    "BluRidge_PMKUSUM_FinanceAdvisory_Agreement_2.docx",
  );
  const templateBytes = await fs.readFile(templatePath);
  return editDocxXml(templateBytes, data);
}

async function editDocxXml(
  templateBytes: Buffer,
  data: AgreementInput,
): Promise<Buffer> {
  const fflate = await import("fflate");

  const uint8 = new Uint8Array(templateBytes);
  const unzipped = fflate.unzipSync(uint8);

  const docXmlKey = "word/document.xml";
  if (!unzipped[docXmlKey]) throw new Error("word/document.xml not found in template");

  let xml = new TextDecoder("utf-8").decode(unzipped[docXmlKey]);

  const effectiveDate = data.effectiveDate || new Date();
  const { day, month, year } = formatDate(effectiveDate);

  // ── 1. Bracket placeholders — single-run, safe for direct replace ────────
  const simple: [string, string][] = [
    ["[Name of Individual / Company / SPV]", data.clientName],
    ["[PAN / CIN (if applicable)]",          data.clientPan || ""],
    ["[Registered / Communication Address]", data.clientAddress || ""],
    ["[GST No. (if applicable)]",            data.clientGstin || ""],
    ["[Client Email]",                       data.clientEmail || ""],
    ["[Client Mobile]",                      data.clientMobile || ""],
    ["[Client / SPV Name]",                  data.spvName || data.clientName],
  ];
  for (const [find, replace] of simple) {
    xml = xmlReplace(xml, find, replace);
  }

  // ── 1b. Execution page blanks — split across 2 runs, need para-level ─────
  // "CIN: " is in run-1 (bold, dark) and "___..." is in run-2 (grey).
  // xmlReplaceParagraphLevel concatenates both before matching.
  const clientName = data.spvName || data.clientName;
  xml = xmlReplaceParagraphLevel(xml, "CIN: _____________________________",
    `CIN: ${data.clientPan || ""}`, );
  xml = xmlReplaceParagraphLevel(xml, "PAN: _____________________________",
    `PAN: ${data.clientPan || ""}`, );
  xml = xmlReplaceParagraphLevel(xml, "GST: _____________________________",
    `GST: ${data.clientGstin || ""}`, );
  xml = xmlReplaceParagraphLevel(xml, "Designation: _____________________________",
    `Designation: ${clientName ? "Authorized Signatory" : "_____________________________"}`,
  );

  // ── 2. Date line: "_____ day of ______________, 2025 / 2026" ────────────
  // This also spans runs; use paragraph-level replacement.
  xml = xmlReplaceParagraphLevel(
    xml,
    "_____ day of ______________, 2025 / 2026",
    `${day} day of ${month}, ${year}`,
  );

  // ── 3. Fee replacements — spans runs (e.g. "1 %" split as "1 " + "%") ──
  // Token fee: "INR 40,000/-" may stay as-is unless user changed it
  const tokenFee = data.tokenFeePerPlant ?? 40000;
  if (tokenFee !== 40000) {
    const formatted = tokenFee.toLocaleString("en-IN");
    xml = xmlReplaceParagraphLevel(xml, "INR 40,000/-", `INR ${formatted}/-`);
    xml = xmlReplaceParagraphLevel(xml, "Fourty Thousand", numberToWords(tokenFee));
  }

  // Success fee percentage: template has "1 %" (run-split)
  const successPct = data.successFeePct ?? 1;
  if (successPct !== 1) {
    xml = xmlReplaceParagraphLevel(xml, "1 %", `${successPct}%`);
    xml = xmlReplaceParagraphLevel(xml, "1%", `${successPct}%`);
  }

  // ── 4. Schedule B — loan type ────────────────────────────────────────────
  if (data.loanType) {
    xml = xmlReplaceParagraphLevel(
      xml,
      "e.g., Agri Loan / SME Loan / Term Loan / CGTMSE-backed / Other: ___________",
      data.loanType,
    );
  }

  // ── 5. Interest rates ("______ % per annum" appears twice: min then max) ─
  if (data.interestMin || data.interestMax) {
    let count = 0;
    xml = xml.replace(/______\s*%\s*per\s*annum/g, () => {
      count++;
      return count === 1
        ? `${data.interestMin || "____"}% per annum`
        : `${data.interestMax || "____"}% per annum`;
    });
  }

  // ── 6. Loan amounts ──────────────────────────────────────────────────────
  if (data.minLoan || data.maxLoan) {
    let loanCount = 0;
    xml = xml.replace(/INR ____________________/g, () => {
      loanCount++;
      return loanCount === 1
        ? `INR ${data.minLoan || "____________"}`
        : `INR ${data.maxLoan || "____________"}`;
    });
  }

  // ── 7. Tenure / moratorium ───────────────────────────────────────────────
  if (data.tenure) {
    xml = xml.replace(/______\s*years/, `${data.tenure} years`);
  }
  if (data.moratorium) {
    xml = xml.replace(/______\s*months/, `${data.moratorium} months`);
  }

  // ── 8. Repayment schedule ────────────────────────────────────────────────
  if (data.repaymentSchedule) {
    xml = xmlReplaceParagraphLevel(
      xml,
      "Monthly EMI / Quarterly / Other: ___________",
      data.repaymentSchedule,
    );
  }

  // ── 9. Collateral ────────────────────────────────────────────────────────
  if (data.collateral) {
    xml = xmlReplaceParagraphLevel(
      xml,
      "(Describe clearly — e.g., Registered Lease Deed of project land, SPV assets, personal guarantee of Promoters): _____________________________________________",
      data.collateral,
    );
  }

  // ── 10. Plant capacity ───────────────────────────────────────────────────
  if (data.plantCapacityAC || data.plantCapacityDC) {
    xml = xmlReplaceParagraphLevel(
      xml,
      "______ MW AC  /  ______ MW DC",
      `${data.plantCapacityAC || "____"} MW AC  /  ${data.plantCapacityDC || "____"} MW DC`,
    );
  }

  // ── 11. PPA tariff ───────────────────────────────────────────────────────
  if (data.tariff) {
    xml = xmlReplaceParagraphLevel(xml, "INR ______  per kWh", `INR ${data.tariff}  per kWh`);
  }

  // ── 12. DPR / project cost (first of the two INR ____ lines in Schedule B) ─
  // "Total Project Cost" blank: the two `INR ___...___` lines in Schedule B
  // after our loan amount replacements are now for project cost & equity
  // They look like "INR _____________________________________________"
  if (data.dprAmount) {
    let dprCount = 0;
    xml = xml.replace(/INR _____________________________________________/g, () => {
      dprCount++;
      return dprCount === 1 ? `INR ${data.dprAmount}` : `INR _____________________________________________`;
    });
  }

  // Encode and rezip
  unzipped[docXmlKey] = new TextEncoder().encode(xml);
  const rezipped = fflate.zipSync(unzipped);
  return Buffer.from(rezipped);
}

function numberToWords(n: number): string {
  const map: Record<number, string> = {
    40000: "Fourty Thousand",
    50000: "Fifty Thousand",
    45000: "Fourty Five Thousand",
    60000: "Sixty Thousand",
    75000: "Seventy Five Thousand",
    100000: "One Lakh",
  };
  return map[n] || `${n.toLocaleString("en-IN")}`;
}
