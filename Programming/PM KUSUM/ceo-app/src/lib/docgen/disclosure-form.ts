import fs from "fs/promises";
import path from "path";
import type { DisclosureExtract } from "@/lib/projects/extract-plant";
import type { SpvSection1 } from "@/lib/projects/spv-section1";
import type { Section23 } from "@/lib/projects/director-section23";
import type { Section4 } from "@/lib/projects/dpr-section4";

export type DisclosureSections = {
  section1?: SpvSection1 | null;
  section23?: Section23 | null;
  section4?: Section4 | null;
};

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function t(v: string | null | undefined): string {
  return (v ?? "").toString().trim();
}

function inr(v: string | null | undefined): string {
  const s = t(v);
  if (!s) return "";
  if (/^INR/i.test(s)) return s;
  return `INR ${s}`;
}

/** True only for a table-cell open tag, not tcPr / tcBorders / tcMar / tcW. */
function isTcOpenAt(xml: string, i: number): boolean {
  return /^<w:tc[\s>]/.test(xml.slice(i, i + 6));
}

function findMatchingTcEnd(xml: string, tcStart: number): number {
  let i = tcStart + 4;
  let depth = 1;
  while (i < xml.length && depth > 0) {
    const nextOpen = xml.indexOf("<w:tc", i);
    const nextClose = xml.indexOf("</w:tc>", i);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose && isTcOpenAt(xml, nextOpen)) {
      depth++;
      i = nextOpen + 4;
      continue;
    }
    depth--;
    if (depth === 0) return nextClose + "</w:tc>".length;
    i = nextClose + "</w:tc>".length;
  }
  return -1;
}

function setCellPlainText(cellXml: string, value: string): string {
  const escaped = xmlEscape(value);
  const runs = [...cellXml.matchAll(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g)];
  if (!runs.length) {
    // Insert a simple run before </w:tc>
    return cellXml.replace(
      /<\/w:tc>$/,
      `<w:p><w:r><w:rPr><w:rFonts w:cs="Calibri"/><w:color w:val="111111"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr><w:t>${escaped}</w:t></w:r></w:p></w:tc>`,
    );
  }
  let first = true;
  return cellXml.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (_m, attrs) => {
    if (first) {
      first = false;
      const space =
        value.startsWith(" ") || value.endsWith(" ") ? ` xml:space="preserve"` : "";
      // Drop italic placeholder styling by leaving attrs as-is but clear i via not touching rPr here —
      // value is enough for readability.
      return `<w:t${attrs}${space}>${escaped}</w:t>`;
    }
    return `<w:t${attrs}></w:t>`;
  });
}

/** Fill the value cell (2nd cell) in the first 2-column row whose label cell equals `label`. */
function fillLabeledRow(xml: string, label: string, value: string): string {
  if (!value) return xml;
  const needles = [`>${label}<`, `>${label} </`, `>${xmlEscape(label)}<`];
  let labelIdx = -1;
  for (const n of needles) {
    labelIdx = xml.indexOf(n);
    if (labelIdx >= 0) break;
  }
  // Also try plain text occurrence inside w:t
  if (labelIdx < 0) {
    const m = xml.match(new RegExp(`<w:t[^>]*>\\s*${escapeRegExp(label)}\\s*</w:t>`));
    if (m && m.index != null) labelIdx = m.index;
  }
  if (labelIdx < 0) return xml;

  const rowStart = xml.lastIndexOf("<w:tr", labelIdx);
  if (rowStart < 0) return xml;
  const rowEnd = xml.indexOf("</w:tr>", labelIdx);
  if (rowEnd < 0) return xml;
  const row = xml.slice(rowStart, rowEnd + "</w:tr>".length);

  // Collect top-level cells in this row
  const cells: Array<{ start: number; end: number }> = [];
  let i = 0;
  while (i < row.length) {
    const rel = row.indexOf("<w:tc", i);
    if (rel < 0) break;
    if (!isTcOpenAt(row, rel)) {
      i = rel + 4;
      continue;
    }
    const abs = rowStart + rel;
    const end = findMatchingTcEnd(xml, abs);
    if (end < 0) break;
    cells.push({ start: abs, end });
    i = end - rowStart;
  }

  if (cells.length < 2) return xml;
  const valueCell = xml.slice(cells[1].start, cells[1].end);
  const filled = setCellPlainText(valueCell, value);
  return xml.slice(0, cells[1].start) + filled + xml.slice(cells[1].end);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fill director table data rows (sr 1..5) by matching a row that starts with that sr number. */
function fillDirectorRows(
  xml: string,
  directors: NonNullable<DisclosureExtract["directors"]>,
): string {
  for (let i = 0; i < Math.min(directors.length, 5); i++) {
    const d = directors[i];
    const sr = String(i + 1);
    // Find a 6-cell row whose first cell text is exactly the sr number
    xml = fillTableRowByFirstCell(xml, sr, [
      sr,
      t(d.name),
      t(d.designation),
      t(d.dinOrPan),
      t(d.dateOfBirth),
      t(d.shareholdingPct) ? `${t(d.shareholdingPct)}%`.replace(/%%$/, "%") : "",
    ]);
  }
  return xml;
}

function fillTableRowByFirstCell(xml: string, firstCellText: string, values: string[]): string {
  const re = new RegExp(`<w:t[^>]*>\\s*${escapeRegExp(firstCellText)}\\s*</w:t>`);
  let searchFrom = 0;
  while (searchFrom < xml.length) {
    const m = re.exec(xml.slice(searchFrom));
    if (!m || m.index == null) return xml;
    const absIdx = searchFrom + m.index;
    const rowStart = xml.lastIndexOf("<w:tr", absIdx);
    const rowEnd = xml.indexOf("</w:tr>", absIdx);
    if (rowStart < 0 || rowEnd < 0) return xml;

    const cells: Array<{ start: number; end: number }> = [];
    let i = rowStart;
    while (i < rowEnd) {
      const rel = xml.indexOf("<w:tc", i);
      if (rel < 0 || rel >= rowEnd) break;
      if (!isTcOpenAt(xml, rel)) {
        i = rel + 4;
        continue;
      }
      const end = findMatchingTcEnd(xml, rel);
      if (end < 0 || end > rowEnd + 10) break;
      cells.push({ start: rel, end });
      i = end;
    }

    // Prefer exact column count so we don't write directors into a 4-col table (or vice versa)
    if (cells.length === values.length) {
      // Verify first cell text
      const first = xml.slice(cells[0].start, cells[0].end);
      const firstText = [...first.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((x) => x[1])
        .join("")
        .trim();
      if (firstText === firstCellText) {
        let out = xml;
        // Replace from the end so offsets stay valid
        for (let c = values.length - 1; c >= 1; c--) {
          if (!values[c]) continue;
          const cell = out.slice(cells[c].start, cells[c].end);
          const filled = setCellPlainText(cell, values[c]);
          out = out.slice(0, cells[c].start) + filled + out.slice(cells[c].end);
        }
        return out;
      }
    }
    searchFrom = absIdx + m[0].length;
  }
  return xml;
}

function fillPromoterNwRows(
  xml: string,
  rows: NonNullable<DisclosureExtract["promotersNetWorth"]>,
): string {
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    const r = rows[i];
    xml = fillTableRowByFirstCell(xml, String(i + 1), [
      String(i + 1),
      t(r.name),
      t(r.netWorth),
      t(r.remarks),
    ]);
  }
  return xml;
}

function replaceOnceParagraph(xml: string, find: string, replace: string): string {
  if (!replace || !find) return xml;
  // Paragraph-level concat replace (same idea as agreement filler)
  return xml.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (para) => {
    const tMatches = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)];
    if (!tMatches.length) return para;
    const combined = tMatches.map((m) => m[1]).join("");
    if (!combined.includes(find)) return para;
    const replaced = combined.replace(find, replace);
    let first = true;
    return para.replace(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/g, (_m, attrs) => {
      if (first) {
        first = false;
        const space =
          replaced.startsWith(" ") || replaced.endsWith(" ")
            ? ` xml:space="preserve"`
            : "";
        return `<w:t${attrs}${space}>${xmlEscape(replaced)}</w:t>`;
      }
      return `<w:t${attrs}></w:t>`;
    });
  });
}

/**
 * Fill the official PMKUSUM disclosure template DOCX in place —
 * preserves layout, styles, and structure of v4.
 */
export async function renderDisclosureDocx(
  extract: DisclosureExtract,
  _meta?: { plantName: string; folderPath: string },
): Promise<Buffer> {
  const templatePath = path.join(
    process.cwd(),
    "templates",
    "PMKUSUM_Borrower_Disclosure_Form_v4.docx",
  );
  const templateBytes = await fs.readFile(templatePath);
  const fflate = await import("fflate");
  const unzipped = fflate.unzipSync(new Uint8Array(templateBytes));
  const docXmlKey = "word/document.xml";
  if (!unzipped[docXmlKey]) throw new Error("word/document.xml not found in disclosure template");

  let xml = new TextDecoder("utf-8").decode(unzipped[docXmlKey]);

  const land = extract.landVerification?.consensus;
  const plant = extract.plant;

  const labelMap: Array<[string, string]> = [
    ["Full Legal Name", t(extract.legalName)],
    ["Brand / Trade Name (if any)", t(extract.tradeName)],
    ["CIN", t(extract.cin)],
    ["PAN", t(extract.pan)],
    ["GST Registration No.", t(extract.gstin)],
    ["Udyam / MSME No. (if any)", t(extract.udyam)],
    ["Authorized Capital (INR)", inr(extract.authorizedCapital)],
    ["Paid-Up Capital — Current (INR)", inr(extract.paidUpCapital)],
    ["Authorized Capital to be increased to (INR)", inr(extract.authorizedCapitalProposed)],
    ["Paid-Up Capital to be increased to (INR)", inr(extract.paidUpCapitalProposed)],
    ["Total Expenses Incurred in SPV so far (INR)", inr(extract.expensesIncurred)],
    ["Registered Office Address", t(extract.registeredAddress)],
    ["SPV Operational / Communication Office Address", t(extract.operationalAddress)],
    ["State", t(extract.state) || t(plant?.state) || t(land?.state)],
    ["District", t(extract.district) || t(plant?.district) || t(land?.district)],
    ["PIN Code", t(extract.pincode)],
    ["Primary Contact Person", t(extract.contactName)],
    ["Designation of Contact Person", t(extract.contactDesignation)],
    ["Mobile (Primary)", t(extract.mobilePrimary)],
    ["Mobile (Alternate)", t(extract.mobileAlternate)],
    ["Email Address", t(extract.email)],
    ["WhatsApp Number", t(extract.whatsapp)],
    ["Bank Name", t(extract.bankName)],
    ["Branch Name & Address", t(extract.bankBranch)],
    ["Account Number", t(extract.bankAccount)],
    ["IFSC Code", t(extract.bankIfsc)],
    ["Account Type", t(extract.bankAccountType)],
    ["Total Liquid Assets of all Promoters (INR)", inr(extract.totalLiquidAssets)],
    ["Minimum Liquidity Required (50% of Margin Money)", inr(extract.minLiquidNetWorth)],
    ["Planned source to bridge liquidity gap (if any)", t(extract.liquidityGapPlan)],
    ["Total EPC Contract Value (INR)", inr(extract.epcContractValue)],
    ["Balance EPC Contract Amount (INR)", inr(extract.epcBalance)],
    ["If Leased — Lessor Name & Relationship", t(plant?.landOwnership)],
    ["Survey No. / Khasra No.", t(land?.khasra) || t(plant?.khasra)],
    ["Village / Gram Panchayat", t(land?.village) || t(plant?.village)],
    ["Tehsil / Block", t(land?.tehsil) || t(plant?.tehsil)],
    ["GPS Coordinates of Plant", ""],
    ["Total Project Cost (DPR)", inr(extract.dprProjectCost)],
    ["Loan Amount Requested", ""],
    ["Promoter Equity / Margin Money (30% of DPR)", inr(extract.marginMoney)],
    ["LOA Reference No. & Date", t(plant?.loaPpaDetails)],
    ["PPA Execution Date / Expected Date", ""],
    ["RRECL / SNA Registration No.", ""],
    ["Expected COD (Commercial Operation Date)", ""],
    ["EPC Company Full Name", t(extract.epc?.legalName)],
    // EPC block also uses CIN/PAN/GST — filled after SPV; last match wins if we only fill first.
    // Handled via sequential unique labels below where possible.
  ];

  for (const [label, value] of labelMap) {
    xml = fillLabeledRow(xml, label, value);
  }

  // EPC CIN/PAN/GSTIN — second occurrence after "EPC Company Full Name"
  if (extract.epc?.cin) xml = fillNthLabeledRow(xml, "CIN", t(extract.epc.cin), 2);
  if (extract.epc?.pan) xml = fillNthLabeledRow(xml, "PAN", t(extract.epc.pan), 2);
  if (extract.epc?.gstin) {
    xml = fillNthLabeledRow(xml, "GST Registration No.", t(extract.epc.gstin), 2);
  }

  // District/State under Project Location (often 2nd occurrence after SPV address)
  if (land?.district || plant?.district) {
    xml = fillNthLabeledRow(xml, "District", t(land?.district || plant?.district), 2);
  }
  if (land?.state || plant?.state) {
    xml = fillNthLabeledRow(xml, "State", t(land?.state || plant?.state), 2);
  }

  // Date line
  if (extract.formDate) {
    xml = replaceOnceParagraph(
      xml,
      "Date: ___________________",
      `Date: ${t(extract.formDate)}`,
    );
  }
  if (extract.fileReferenceNo) {
    xml = replaceOnceParagraph(
      xml,
      "File / Reference No.: ___________________",
      `File / Reference No.: ${t(extract.fileReferenceNo)}`,
    );
  }

  // Capacity blanks
  if (plant?.capacityAcMw || plant?.capacityDcMwp) {
    xml = replaceOnceParagraph(
      xml,
      "______ MW AC   /   ______ MW DC",
      `${t(plant?.capacityAcMw) || "____"} MW AC   /   ${t(plant?.capacityDcMwp) || "____"} MW DC`,
    );
  }

  // Tariff
  if (plant?.tariff) {
    xml = replaceOnceParagraph(xml, "INR ______", `INR ${t(plant.tariff)}`);
  }

  // Equity guide steps
  if (extract.dprProjectCost) {
    xml = replaceOnceParagraph(
      xml,
      "Total DPR Project Cost (INR):  ___________________",
      `Total DPR Project Cost (INR):  ${t(extract.dprProjectCost)}`,
    );
  }
  if (extract.marginMoney) {
    xml = replaceOnceParagraph(
      xml,
      "Margin Money (Promoter Equity + USL) = 30% of DPR:  INR ___________________",
      `Margin Money (Promoter Equity + USL) = 30% of DPR:  ${inr(extract.marginMoney)}`,
    );
  }

  if (extract.totalPaidToEpc) {
    xml = replaceOnceParagraph(
      xml,
      "TOTAL PAID TO EPC SO FAR",
      "TOTAL PAID TO EPC SO FAR",
    );
    // value is on the next INR blank in many layouts — also set labeled if present
  }

  if (extract.directors?.length) xml = fillDirectorRows(xml, extract.directors);
  if (extract.promotersNetWorth?.length) {
    xml = fillPromoterNwRows(xml, extract.promotersNetWorth);
  }

  // Combined net worth blank
  if (extract.combinedNetWorth) {
    xml = replaceOnceParagraph(
      xml,
      "COMBINED NET WORTH OF ALL PROMOTERS",
      "COMBINED NET WORTH OF ALL PROMOTERS",
    );
    xml = fillLabeledRow(xml, "COMBINED NET WORTH OF ALL PROMOTERS", inr(extract.combinedNetWorth));
  }

  unzipped[docXmlKey] = new TextEncoder().encode(xml);
  return Buffer.from(fflate.zipSync(unzipped));
}

function fillNthLabeledRow(
  xml: string,
  label: string,
  value: string,
  n: number,
): string {
  if (!value || n < 1) return xml;
  let from = 0;
  let hit = 0;
  while (from < xml.length) {
    const idx = xml.indexOf(`>${label}<`, from);
    if (idx < 0) {
      // try with spaces
      const m = xml.slice(from).match(new RegExp(`<w:t[^>]*>\\s*${escapeRegExp(label)}\\s*</w:t>`));
      if (!m || m.index == null) return xml;
      const abs = from + m.index;
      hit++;
      if (hit === n) {
        // temporarily mark and reuse fillLabeledRow by slicing — easier: fill from this occurrence only
        return fillLabeledRowFromIndex(xml, abs, value);
      }
      from = abs + 1;
      continue;
    }
    hit++;
    if (hit === n) return fillLabeledRowFromIndex(xml, idx, value);
    from = idx + 1;
  }
  return xml;
}

function fillLabeledRowFromIndex(xml: string, labelIdx: number, value: string): string {
  const rowStart = xml.lastIndexOf("<w:tr", labelIdx);
  const rowEnd = xml.indexOf("</w:tr>", labelIdx);
  if (rowStart < 0 || rowEnd < 0) return xml;

  const cells: Array<{ start: number; end: number }> = [];
  let i = rowStart;
  while (i < rowEnd) {
    const rel = xml.indexOf("<w:tc", i);
    if (rel < 0 || rel >= rowEnd) break;
    if (!isTcOpenAt(xml, rel)) {
      i = rel + 4;
      continue;
    }
    const end = findMatchingTcEnd(xml, rel);
    if (end < 0) break;
    cells.push({ start: rel, end });
    i = end;
  }
  if (cells.length < 2) return xml;
  const valueCell = xml.slice(cells[1].start, cells[1].end);
  const filled = setCellPlainText(valueCell, value);
  return xml.slice(0, cells[1].start) + filled + xml.slice(cells[1].end);
}

function applySection1(xml: string, section1: SpvSection1): string {
  const labelMap: Array<[string, string]> = [
    ["Type of Applicant", t(section1.applicantType)],
    ["Full Legal Name", t(section1.legalName)],
    ["Brand / Trade Name (if any)", t(section1.tradeName)],
    ["CIN", t(section1.cin)],
    ["PAN", t(section1.pan)],
    ["GST Registration No.", t(section1.gstin)],
    ["Udyam / MSME No. (if any)", t(section1.udyam)],
    ["Authorized Capital (INR)", inr(section1.authorizedCapital)],
    ["Paid-Up Capital — Current (INR)", inr(section1.paidUpCapital)],
    ["Authorized Capital to be increased to (INR)", inr(section1.authorizedCapitalProposed)],
    ["Paid-Up Capital to be increased to (INR)", inr(section1.paidUpCapitalProposed)],
    ["Total Expenses Incurred in SPV so far (INR)", inr(section1.expensesIncurred)],
    ["Registered Office Address", t(section1.registeredAddress)],
    ["SPV Operational / Communication Office Address", t(section1.operationalAddress)],
    ["State", t(section1.state)],
    ["District", t(section1.district)],
    ["PIN Code", t(section1.pincode)],
    ["Primary Contact Person", t(section1.contactName)],
    ["Designation of Contact Person", t(section1.contactDesignation)],
    ["Mobile (Primary)", t(section1.mobilePrimary)],
    ["Mobile (Alternate)", t(section1.mobileAlternate)],
    ["Email Address", t(section1.email)],
    ["WhatsApp Number", t(section1.whatsapp)],
    ["Bank Name", t(section1.bankName)],
    ["Branch Name & Address", t(section1.bankBranch)],
    ["Account Number", t(section1.bankAccount)],
    ["IFSC Code", t(section1.bankIfsc)],
    ["Account Type", t(section1.bankAccountType)],
  ];
  for (const [label, value] of labelMap) {
    if (!value) continue;
    xml = fillLabeledRow(xml, label, value);
  }
  return xml;
}

function applySection23(xml: string, s: Section23): string {
  if (s.directors?.length) {
    xml = fillDirectorRows(xml, s.directors);
  }
  if (s.promotersNetWorth?.length) {
    xml = fillPromoterNwRows(xml, s.promotersNetWorth);
  }
  if (s.combinedNetWorth) {
    xml = fillLabeledRow(xml, "COMBINED NET WORTH OF ALL PROMOTERS", inr(s.combinedNetWorth));
  }
  if (s.totalLiquidAssets) {
    xml = fillLabeledRow(
      xml,
      "Total Liquid Assets of all Promoters (INR)",
      inr(s.totalLiquidAssets),
    );
  }
  if (s.liquidityMet) {
    xml = fillLabeledRow(xml, "Is Minimum Liquidity Met?", t(s.liquidityMet));
  }
  if (s.liquidityGapPlan) {
    xml = fillLabeledRow(
      xml,
      "Planned source to bridge liquidity gap (if any)",
      t(s.liquidityGapPlan),
    );
  }
  return xml;
}

function applySection4(xml: string, s: Section4): string {
  const firstPass: Array<[string, string]> = [
    ["PM KUSUM Component", t(s.component)],
    ["Panel Type", t(s.panelType)],
    ["Land Ownership", t(s.landOwnership)],
    ["If Leased — Lease Tenure", t(s.leaseTenure)],
    ["If Leased — Lessor Name & Relationship", t(s.lessorName)],
    ["DISCOM / Nodal Agency", t(s.discom)],
    ["PPA Tariff (INR / kWh)", t(s.tariff)],
    ["PPA Tenure (years)", t(s.ppaTenureYears)],
    ["Capacity (AC MW / DC MW)", t(s.capacityAcDcLabel) ||
      (s.capacityAcMw || s.capacityDcMwp
        ? `${t(s.capacityAcMw) || "—"} MW AC / ${t(s.capacityDcMwp) || "—"} MW DC`
        : "")],
    ["Module Technology", t(s.moduleTechnology)],
    ["Inverter Type", t(s.inverterType)],
    ["Mounting Type", t(s.mountingType)],
    ["P90 Generation (kWh/MWp/year)", t(s.p90Generation)],
    ["P50 Generation (kWh/MWp/year)", t(s.p50Generation)],
    ["Module Efficiency — Year 1 (%)", t(s.moduleEfficiencyY1)],
    ["Annual Degradation Rate (%)", t(s.annualDegradation)],
    ["25-Year Total Energy Yield (MWh)", t(s.yield25YearMwh)],
    ["PVSyst Report Available?", t(s.pvsystAvailable)],
    ["Survey No. / Khasra No.", t(s.khasra)],
    ["Village / Gram Panchayat", t(s.village)],
    ["Tehsil / Block", t(s.tehsil)],
    ["GPS Coordinates of Plant", t(s.gpsPlant)],
    ["GPS Coordinates of GSS", t(s.gpsGss)],
    ["Distance from GSS to Plant (km)", t(s.distanceGssKm)],
    ["Total Project Cost (DPR)", inr(s.dprProjectCost)],
    ["Loan Amount Requested", inr(s.loanAmountRequested)],
    ["Promoter Equity / Margin Money (30% of DPR)", inr(s.marginMoney)],
    ["LOA Reference No. & Date", t(s.loaRef)],
    ["PPA Execution Date / Expected Date", t(s.ppaDate)],
    ["RRECL / SNA Registration No.", t(s.rreclRegNo)],
    ["Expected COD (Commercial Operation Date)", t(s.expectedCod)],
    ["Current Overall Completion %", t(s.siteCompletionPct)],
  ];

  for (const [label, value] of firstPass) {
    if (!value) continue;
    xml = fillLabeledRow(xml, label, value);
  }

  // Duplicate scheme / location labels under Section 4
  if (s.component) xml = fillNthLabeledRow(xml, "PM KUSUM Component", t(s.component), 2);
  if (s.panelType) xml = fillNthLabeledRow(xml, "Panel Type", t(s.panelType), 2);
  if (s.district) xml = fillNthLabeledRow(xml, "District", t(s.district), 2);
  if (s.state) xml = fillNthLabeledRow(xml, "State", t(s.state), 2);

  if (s.capacityAcMw || s.capacityDcMwp) {
    xml = replaceOnceParagraph(
      xml,
      "______ MW AC   /   ______ MW DC",
      `${t(s.capacityAcMw) || "____"} MW AC   /   ${t(s.capacityDcMwp) || "____"} MW DC`,
    );
  }
  if (s.tariff) {
    xml = replaceOnceParagraph(xml, "INR ______", `INR ${t(s.tariff)}`);
  }
  if (s.dprProjectCost) {
    xml = replaceOnceParagraph(
      xml,
      "Total DPR Project Cost (INR):  ___________________",
      `Total DPR Project Cost (INR):  ${t(s.dprProjectCost)}`,
    );
  }
  if (s.marginMoney) {
    xml = replaceOnceParagraph(
      xml,
      "Margin Money (Promoter Equity + USL) = 30% of DPR:  INR ___________________",
      `Margin Money (Promoter Equity + USL) = 30% of DPR:  ${inr(s.marginMoney)}`,
    );
  }
  if (s.workDoneBrief) {
    xml = replaceOnceParagraph(
      xml,
      "Brief description of work done so far",
      `Brief description of work done so far: ${t(s.workDoneBrief)}`,
    );
  }

  return xml;
}

/** Fill official v4 template from any combination of completed section extracts. */
export async function fillDisclosureSectionsDocx(
  sections: DisclosureSections,
): Promise<Buffer> {
  const templatePath = path.join(
    process.cwd(),
    "templates",
    "PMKUSUM_Borrower_Disclosure_Form_v4.docx",
  );
  const templateBytes = await fs.readFile(templatePath);
  const fflate = await import("fflate");
  const unzipped = fflate.unzipSync(new Uint8Array(templateBytes));
  const docXmlKey = "word/document.xml";
  if (!unzipped[docXmlKey]) throw new Error("word/document.xml not found in disclosure template");

  let xml = new TextDecoder("utf-8").decode(unzipped[docXmlKey]);

  if (sections.section1) xml = applySection1(xml, sections.section1);
  if (sections.section23) xml = applySection23(xml, sections.section23);
  if (sections.section4) xml = applySection4(xml, sections.section4);

  if (sections.section4?.marginMoney) {
    const digits = t(sections.section4.marginMoney).replace(/INR/gi, "").replace(/,/g, "").trim();
    const num = Number(digits);
    if (Number.isFinite(num) && num > 0) {
      const half = Math.round(num * 0.5);
      const formatted = half.toLocaleString("en-IN");
      xml = fillLabeledRow(
        xml,
        "Minimum Liquidity Required (50% of Margin Money)",
        `INR ${formatted}`,
      );
      xml = replaceOnceParagraph(
        xml,
        "Minimum Liquid Net Worth Required = 50% of Margin Money:  INR ___________________",
        `Minimum Liquid Net Worth Required = 50% of Margin Money:  INR ${formatted}`,
      );
    }
  }

  unzipped[docXmlKey] = new TextEncoder().encode(xml);
  return Buffer.from(fflate.zipSync(unzipped));
}

/** Fill only Section 1 (Applicant / SPV Details) on the official v4 template. */
export async function fillSection1DisclosureDocx(section1: SpvSection1): Promise<Buffer> {
  return fillDisclosureSectionsDocx({ section1 });
}
