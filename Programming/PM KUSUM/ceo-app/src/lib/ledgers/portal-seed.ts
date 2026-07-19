import { prisma } from "@/lib/prisma";
import { financialYearFromDate } from "@/lib/invoice/financial-year";
import { retentionUntilForDate } from "@/lib/ledgers/retention";
import { writeAuditLog } from "@/lib/ledgers/audit";
import { postItcFromInward } from "@/lib/ledgers/inward";

type PortalB2bRow = {
  ctin?: string;
  trdnm?: string;
  inum?: string;
  idt?: string;
  val?: number;
  txval?: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  pos?: string;
  rev?: string;
};

function parsePortalDate(idt?: string): Date {
  if (!idt) return new Date();
  // DD-MM-YYYY or YYYY-MM-DD
  const m = idt.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(idt);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function flattenGstr2b(json: unknown): PortalB2bRow[] {
  const rows: PortalB2bRow[] = [];
  const root = json as Record<string, unknown>;
  const data = (root.data || root) as Record<string, unknown>;
  const docdata = (data.docdata || data) as Record<string, unknown>;
  const b2b = (docdata.b2b || data.b2b || []) as Array<Record<string, unknown>>;

  for (const party of b2b) {
    const ctin = String(party.ctin || party.GSTIN || "");
    const trdnm = String(party.trdnm || party.traderName || party.lgl_nm || "");
    const invs = (party.inv || party.invoices || []) as Array<Record<string, unknown>>;
    if (Array.isArray(invs) && invs.length) {
      for (const inv of invs) {
        rows.push({
          ctin,
          trdnm,
          inum: String(inv.inum || inv.inum || inv.invoice_number || ""),
          idt: String(inv.idt || inv.invoice_date || ""),
          val: Number(inv.val || inv.invoice_value || 0),
          txval: Number(inv.txval || inv.taxable || 0),
          iamt: Number(inv.iamt || inv.igst || 0),
          camt: Number(inv.camt || inv.cgst || 0),
          samt: Number(inv.samt || inv.sgst || 0),
          pos: String(inv.pos || ""),
          rev: String(inv.rev || "N"),
        });
      }
    } else if (party.inum || party.invoice_number) {
      rows.push({
        ctin,
        trdnm,
        inum: String(party.inum || party.invoice_number || ""),
        idt: String(party.idt || party.invoice_date || ""),
        val: Number(party.val || 0),
        txval: Number(party.txval || 0),
        iamt: Number(party.iamt || 0),
        camt: Number(party.camt || 0),
        samt: Number(party.samt || 0),
        pos: String(party.pos || ""),
      });
    }
  }
  return rows;
}

function flattenGstr1(json: unknown): PortalB2bRow[] {
  const rows: PortalB2bRow[] = [];
  const root = json as Record<string, unknown>;
  const b2b = (root.b2b || []) as Array<Record<string, unknown>>;
  for (const party of b2b) {
    const ctin = String(party.ctin || "");
    const invs = (party.inv || []) as Array<Record<string, unknown>>;
    for (const inv of invs) {
      const itms = (inv.itms || []) as Array<Record<string, unknown>>;
      let txval = 0;
      let iamt = 0;
      let camt = 0;
      let samt = 0;
      for (const it of itms) {
        const det = (it.itm_det || it) as Record<string, unknown>;
        txval += Number(det.txval || 0);
        iamt += Number(det.iamt || 0);
        camt += Number(det.camt || 0);
        samt += Number(det.samt || 0);
      }
      rows.push({
        ctin,
        trdnm: "",
        inum: String(inv.inum || ""),
        idt: String(inv.idt || ""),
        val: Number(inv.val || txval + iamt + camt + samt),
        txval,
        iamt,
        camt,
        samt,
        pos: String(inv.pos || ""),
      });
    }
  }
  return rows;
}

export async function seedFromGstr2bJson(
  json: unknown,
  opts?: { gstEntity?: string; actorUserId?: string | null },
) {
  const company = await prisma.companyProfile.findFirst();
  const retentionMonths = company?.retentionMonths ?? 72;
  const rows = flattenGstr2b(json);
  let created = 0;

  for (const r of rows) {
    if (!r.inum && !r.txval) continue;
    const billDate = parsePortalDate(r.idt);
    const fy = financialYearFromDate(billDate);
    const taxable = r.txval || Math.max(0, (r.val || 0) - (r.iamt || 0) - (r.camt || 0) - (r.samt || 0));
    const entry = await prisma.inwardSupplyEntry.create({
      data: {
        financialYear: fy,
        gstEntity: opts?.gstEntity || null,
        supplierName: r.trdnm || r.ctin || "Portal supplier",
        supplierGstin: r.ctin || null,
        billNumber: r.inum || null,
        billDate,
        placeOfSupplyStateCode: r.pos || null,
        reverseCharge: r.rev === "Y",
        taxableValue: taxable,
        cgstAmount: r.camt || 0,
        sgstAmount: r.samt || 0,
        igstAmount: r.iamt || 0,
        grandTotal: r.val || taxable + (r.camt || 0) + (r.samt || 0) + (r.iamt || 0),
        source: "PORTAL",
        itcEligible: true,
        retentionUntil: retentionUntilForDate(billDate, retentionMonths),
      },
    });
    await writeAuditLog({
      entityType: "InwardSupplyEntry",
      entityId: entry.id,
      action: "SEED",
      after: entry,
      actorUserId: opts?.actorUserId,
    });
    await postItcFromInward(entry.id, opts?.actorUserId);
    created++;
  }

  return { created, kind: "GSTR2B" as const };
}

export async function seedFromGstr1Json(
  json: unknown,
  opts?: { gstEntity?: string; actorUserId?: string | null },
) {
  const company = await prisma.companyProfile.findFirst();
  const retentionMonths = company?.retentionMonths ?? 72;
  const rows = flattenGstr1(json);
  let created = 0;

  for (const r of rows) {
    if (!r.inum) continue;
    const documentDate = parsePortalDate(r.idt);
    const fy = financialYearFromDate(documentDate);
    const entry = await prisma.outwardSupplyEntry.create({
      data: {
        financialYear: fy,
        gstEntity: opts?.gstEntity || null,
        documentType: "TAX_INVOICE",
        documentNumber: r.inum,
        documentDate,
        buyerName: r.ctin || "Portal buyer",
        buyerGstin: r.ctin || null,
        placeOfSupplyStateCode: r.pos || null,
        taxableValue: r.txval || 0,
        cgstAmount: r.camt || 0,
        sgstAmount: r.samt || 0,
        igstAmount: r.iamt || 0,
        grandTotal: r.val || 0,
        source: "PORTAL",
        retentionUntil: retentionUntilForDate(documentDate, retentionMonths),
      },
    });
    await writeAuditLog({
      entityType: "OutwardSupplyEntry",
      entityId: entry.id,
      action: "SEED",
      after: entry,
      actorUserId: opts?.actorUserId,
    });
    created++;
  }

  return { created, kind: "GSTR1" as const };
}

/** Simple CSV: gstin,name,inum,idt,txval,cgst,sgst,igst,val,pos */
export function parseInwardCsv(text: string): PortalB2bRow[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const rows: PortalB2bRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 5) continue;
    rows.push({
      ctin: cols[0],
      trdnm: cols[1],
      inum: cols[2],
      idt: cols[3],
      txval: Number(cols[4] || 0),
      camt: Number(cols[5] || 0),
      samt: Number(cols[6] || 0),
      iamt: Number(cols[7] || 0),
      val: Number(cols[8] || 0),
      pos: cols[9],
    });
  }
  return rows;
}

export async function seedInwardFromCsvRows(
  rows: PortalB2bRow[],
  opts?: { gstEntity?: string; actorUserId?: string | null },
) {
  return seedFromGstr2bJson({ data: { docdata: { b2b: rows.map((r) => ({
    ctin: r.ctin,
    trdnm: r.trdnm,
    inv: [{ inum: r.inum, idt: r.idt, txval: r.txval, camt: r.camt, samt: r.samt, iamt: r.iamt, val: r.val, pos: r.pos }],
  })) } } }, opts);
}
