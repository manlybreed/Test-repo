import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/ledgers/audit";

export type LedgerRegister =
  | "outward"
  | "inward"
  | "itc"
  | "advance"
  | "stock"
  | "audit";

function csvEscape(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export async function exportLedgerCsv(input: {
  register: LedgerRegister;
  from?: string;
  to?: string;
  gstEntity?: string;
  financialYear?: string;
  actorUserId?: string | null;
}): Promise<{ csv: string; filename: string; rowCount: number }> {
  const dateFilter =
    input.from || input.to
      ? {
          gte: input.from ? new Date(input.from) : undefined,
          lte: input.to ? new Date(input.to) : undefined,
        }
      : undefined;

  let csv = "";
  let rowCount = 0;
  const tag = [
    input.financialYear || "all",
    input.gstEntity || "all",
    input.from || "start",
    input.to || "end",
  ].join("_");

  if (input.register === "outward") {
    const rows = await prisma.outwardSupplyEntry.findMany({
      where: {
        ...(input.gstEntity ? { gstEntity: input.gstEntity } : {}),
        ...(input.financialYear ? { financialYear: input.financialYear } : {}),
        ...(dateFilter ? { documentDate: dateFilter } : {}),
      },
      orderBy: { documentDate: "asc" },
    });
    const header = [
      "DocumentType",
      "DocumentNumber",
      "DocumentDate",
      "FY",
      "GstEntity",
      "BuyerName",
      "BuyerGstin",
      "POS",
      "ReverseCharge",
      "Taxable",
      "CGST",
      "SGST",
      "IGST",
      "GrandTotal",
      "Source",
      "StruckOut",
      "StruckReason",
      "RetentionUntil",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.documentType,
          r.documentNumber,
          iso(r.documentDate),
          r.financialYear,
          r.gstEntity,
          csvEscape(r.buyerName),
          r.buyerGstin,
          r.placeOfSupplyStateCode,
          r.reverseCharge ? "Y" : "N",
          r.taxableValue,
          r.cgstAmount,
          r.sgstAmount,
          r.igstAmount,
          r.grandTotal,
          r.source,
          r.struckOutAt ? "Y" : "N",
          csvEscape(r.struckOutReason),
          iso(r.retentionUntil),
        ].join(","),
      );
    }
    csv = lines.join("\n");
    rowCount = rows.length;
  } else if (input.register === "inward") {
    const rows = await prisma.inwardSupplyEntry.findMany({
      where: {
        ...(input.gstEntity ? { gstEntity: input.gstEntity } : {}),
        ...(input.financialYear ? { financialYear: input.financialYear } : {}),
        ...(dateFilter ? { billDate: dateFilter } : {}),
      },
      orderBy: { billDate: "asc" },
    });
    const header = [
      "BillNumber",
      "BillDate",
      "FY",
      "GstEntity",
      "SupplierName",
      "SupplierGstin",
      "SupplierAddress",
      "HSN",
      "POS",
      "Taxable",
      "CGST",
      "SGST",
      "IGST",
      "GrandTotal",
      "ItcEligible",
      "Source",
      "StruckOut",
      "RetentionUntil",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.billNumber,
          iso(r.billDate),
          r.financialYear,
          r.gstEntity,
          csvEscape(r.supplierName),
          r.supplierGstin,
          csvEscape(r.supplierAddress),
          r.hsn,
          r.placeOfSupplyStateCode,
          r.taxableValue,
          r.cgstAmount,
          r.sgstAmount,
          r.igstAmount,
          r.grandTotal,
          r.itcEligible ? "Y" : "N",
          r.source,
          r.struckOutAt ? "Y" : "N",
          iso(r.retentionUntil),
        ].join(","),
      );
    }
    csv = lines.join("\n");
    rowCount = rows.length;
  } else if (input.register === "itc") {
    const rows = await prisma.itcLedgerEntry.findMany({
      where: {
        ...(input.gstEntity ? { gstEntity: input.gstEntity } : {}),
        ...(input.financialYear ? { financialYear: input.financialYear } : {}),
      },
      orderBy: { periodYm: "asc" },
    });
    const header = [
      "Period",
      "FY",
      "GstEntity",
      "Status",
      "CGST",
      "SGST",
      "IGST",
      "TotalITC",
      "Source",
      "StruckOut",
      "Notes",
      "RetentionUntil",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.periodYm,
          r.financialYear,
          r.gstEntity,
          r.status,
          r.cgstAmount,
          r.sgstAmount,
          r.igstAmount,
          r.totalItc,
          r.source,
          r.struckOutAt ? "Y" : "N",
          csvEscape(r.notes),
          iso(r.retentionUntil),
        ].join(","),
      );
    }
    csv = lines.join("\n");
    rowCount = rows.length;
  } else if (input.register === "advance") {
    const rows = await prisma.advanceLedgerEntry.findMany({
      where: {
        ...(input.gstEntity ? { gstEntity: input.gstEntity } : {}),
        ...(input.financialYear ? { financialYear: input.financialYear } : {}),
        ...(dateFilter ? { documentDate: dateFilter } : {}),
      },
      orderBy: { documentDate: "asc" },
    });
    const header = [
      "Kind",
      "DocumentNumber",
      "DocumentDate",
      "FY",
      "GstEntity",
      "PartyName",
      "PartyGstin",
      "Amount",
      "TaxAmount",
      "Source",
      "StruckOut",
      "RetentionUntil",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.kind,
          r.documentNumber,
          iso(r.documentDate),
          r.financialYear,
          r.gstEntity,
          csvEscape(r.partyName),
          r.partyGstin,
          r.amount,
          r.taxAmount,
          r.source,
          r.struckOutAt ? "Y" : "N",
          iso(r.retentionUntil),
        ].join(","),
      );
    }
    csv = lines.join("\n");
    rowCount = rows.length;
  } else if (input.register === "stock") {
    const company = await prisma.companyProfile.findFirst();
    if (!company?.maintainsStockLedger) {
      csv =
        "Note\nStock ledger not maintained (services / maintainsStockLedger=false). Composition and service-only taxpayers typically do not require stock registers.\n";
      rowCount = 0;
    } else {
      const rows = await prisma.stockLedgerEntry.findMany({
        where: {
          ...(input.financialYear ? { financialYear: input.financialYear } : {}),
          ...(dateFilter ? { movementDate: dateFilter } : {}),
        },
        orderBy: { movementDate: "asc" },
      });
      const header = [
        "Movement",
        "Date",
        "Item",
        "Code",
        "UQC",
        "Qty",
        "DocRef",
        "StruckOut",
      ];
      const lines = [header.join(",")];
      for (const r of rows) {
        lines.push(
          [
            r.movement,
            iso(r.movementDate),
            csvEscape(r.itemDescription),
            r.itemCode,
            r.uqc,
            r.quantity,
            r.documentRef,
            r.struckOutAt ? "Y" : "N",
          ].join(","),
        );
      }
      csv = lines.join("\n");
      rowCount = rows.length;
    }
  } else {
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(dateFilter?.gte || dateFilter?.lte
          ? { createdAt: dateFilter }
          : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
    const header = [
      "At",
      "EntityType",
      "EntityId",
      "Action",
      "Reason",
      "Actor",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.createdAt.toISOString(),
          r.entityType,
          r.entityId,
          r.action,
          csvEscape(r.reason),
          r.actorUserId,
        ].join(","),
      );
    }
    csv = lines.join("\n");
    rowCount = rows.length;
  }

  await writeAuditLog({
    entityType: "LedgerExport",
    entityId: input.register,
    action: "EXPORT",
    after: { register: input.register, rowCount, tag },
    actorUserId: input.actorUserId,
  });

  return {
    csv,
    filename: `gst-${input.register}-${tag}.csv`,
    rowCount,
  };
}
