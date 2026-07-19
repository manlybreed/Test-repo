import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Image,
} from "@react-pdf/renderer";
import path from "path";
import { amountInWordsINR, formatINRPlain } from "@/lib/utils";
import {
  DOCUMENT_TITLE,
  type InvoiceDocumentType,
} from "@/lib/invoice/types";

export type InvoicePdfInput = {
  number: string;
  date: Date;
  documentType?: InvoiceDocumentType;
  reverseCharge?: boolean;
  placeOfSupplyState?: string | null;
  placeOfSupplyStateCode?: string | null;
  roundOff?: number;
  originalNumber?: string | null;
  logoPath?: string;
  seller: {
    legalName: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state: string;
    stateCode: string;
    gstin: string;
  };
  buyer: {
    name: string;
    address?: string | null;
    gstin?: string | null;
    state?: string | null;
    stateCode?: string | null;
  };
  lines: {
    description: string;
    hsn: string;
    quantity: number;
    rate: number;
    amount: number;
  }[];
  taxableTotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  grandTotal: number;
  remarks?: string | null;
};

const s = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111",
  },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#0a1628",
  },
  subtitle: {
    textAlign: "center",
    fontSize: 8,
    color: "#555",
    marginBottom: 10,
  },
  row: { flexDirection: "row" },
  box: {
    borderWidth: 1,
    borderColor: "#333",
    padding: 8,
  },
  half: { width: "50%" },
  label: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#444", marginBottom: 1 },
  tableHeader: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#333",
    backgroundColor: "#f0f0f0",
    fontFamily: "Helvetica-Bold",
  },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#333",
  },
  cell: { padding: 4, borderRightWidth: 1, borderRightColor: "#333" },
  cellLast: { padding: 4 },
  right: { textAlign: "right" },
  footer: { marginTop: 16, fontSize: 8, color: "#555" },
});

function InvoiceDoc({ data }: { data: InvoicePdfInput }) {
  const docType = data.documentType ?? "TAX_INVOICE";
  const title = DOCUMENT_TITLE[docType] ?? "Tax Invoice";
  const dateStr = data.date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
  const posLabel =
    data.placeOfSupplyState ||
    data.buyer.state ||
    "";
  const posCode =
    data.placeOfSupplyStateCode || data.buyer.stateCode || "";

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.brandRow}>
          {data.logoPath ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image
            <Image src={data.logoPath} style={{ width: 120, height: 37 }} />
          ) : (
            <View />
          )}
          <Text style={s.title}>{title}</Text>
        </View>
        {docType === "PROFORMA" ? (
          <Text style={s.subtitle}>
            This is not a tax invoice. For quotation / advance billing only.
          </Text>
        ) : null}
        {data.originalNumber ? (
          <Text style={s.subtitle}>
            Against original document: {data.originalNumber}
          </Text>
        ) : null}

        <View style={[s.row, { marginBottom: 0 }]}>
          <View style={[s.box, s.half, { borderRightWidth: 0 }]}>
            <Text style={s.label}>{data.seller.legalName}</Text>
            <Text style={s.muted}>{data.seller.addressLine1}</Text>
            {data.seller.addressLine2 ? (
              <Text style={s.muted}>{data.seller.addressLine2}</Text>
            ) : null}
            <Text style={s.muted}>
              {data.seller.city}, {data.seller.state}
            </Text>
            <Text style={s.muted}>GSTIN/UIN: {data.seller.gstin}</Text>
            <Text style={s.muted}>
              State Name: {data.seller.state}, Code: {data.seller.stateCode}
            </Text>
          </View>
          <View style={[s.box, s.half]}>
            <Text style={s.muted}>Document No.</Text>
            <Text style={s.label}>{data.number}</Text>
            <Text style={[s.muted, { marginTop: 6 }]}>Dated</Text>
            <Text style={s.label}>{dateStr}</Text>
            <Text style={[s.muted, { marginTop: 6 }]}>Place of Supply</Text>
            <Text style={s.label}>
              {posLabel}
              {posCode ? ` (${posCode})` : ""}
            </Text>
            <Text style={[s.muted, { marginTop: 6 }]}>Reverse Charge</Text>
            <Text style={s.label}>{data.reverseCharge ? "Yes" : "No"}</Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 0 }]}>
          <View style={[s.box, { width: "100%", borderTopWidth: 0 }]}>
            <Text style={s.label}>Buyer (Bill to)</Text>
            <Text>{data.buyer.name}</Text>
            {data.buyer.address ? (
              <Text style={s.muted}>{data.buyer.address}</Text>
            ) : null}
            {data.buyer.gstin ? (
              <Text style={s.muted}>GSTIN/UIN: {data.buyer.gstin}</Text>
            ) : (
              <Text style={s.muted}>GSTIN/UIN: Unregistered</Text>
            )}
            {data.buyer.state ? (
              <Text style={s.muted}>
                State Name: {data.buyer.state}
                {data.buyer.stateCode ? `, Code: ${data.buyer.stateCode}` : ""}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={[s.tableHeader, { marginTop: 10 }]}>
          <Text style={[s.cell, { width: "6%" }]}>Sl</Text>
          <Text style={[s.cell, { width: "38%" }]}>Description</Text>
          <Text style={[s.cell, { width: "14%" }]}>HSN/SAC</Text>
          <Text style={[s.cell, { width: "10%" }]}>Qty</Text>
          <Text style={[s.cell, { width: "16%" }]}>Rate</Text>
          <Text style={[s.cellLast, { width: "16%" }]}>Amount</Text>
        </View>

        {data.lines.map((line, i) => (
          <View key={i} style={s.tableRow}>
            <Text style={[s.cell, { width: "6%" }]}>{i + 1}</Text>
            <Text style={[s.cell, { width: "38%" }]}>{line.description}</Text>
            <Text style={[s.cell, { width: "14%" }]}>{line.hsn}</Text>
            <Text style={[s.cell, s.right, { width: "10%" }]}>
              {line.quantity}
            </Text>
            <Text style={[s.cell, s.right, { width: "16%" }]}>
              {formatINRPlain(line.rate)}
            </Text>
            <Text style={[s.cellLast, s.right, { width: "16%" }]}>
              {formatINRPlain(line.amount)}
            </Text>
          </View>
        ))}

        <View style={[s.tableRow, { fontFamily: "Helvetica-Bold" }]}>
          <Text style={[s.cell, { width: "84%" }]}>Taxable Total</Text>
          <Text style={[s.cellLast, s.right, { width: "16%" }]}>
            {formatINRPlain(data.taxableTotal)}
          </Text>
        </View>
        {data.igstAmount > 0 ? (
          <View style={s.tableRow}>
            <Text style={[s.cell, { width: "84%" }]}>IGST @ 18%</Text>
            <Text style={[s.cellLast, s.right, { width: "16%" }]}>
              {formatINRPlain(data.igstAmount)}
            </Text>
          </View>
        ) : (
          <>
            <View style={s.tableRow}>
              <Text style={[s.cell, { width: "84%" }]}>CGST @ 9%</Text>
              <Text style={[s.cellLast, s.right, { width: "16%" }]}>
                {formatINRPlain(data.cgstAmount)}
              </Text>
            </View>
            <View style={s.tableRow}>
              <Text style={[s.cell, { width: "84%" }]}>SGST @ 9%</Text>
              <Text style={[s.cellLast, s.right, { width: "16%" }]}>
                {formatINRPlain(data.sgstAmount)}
              </Text>
            </View>
          </>
        )}
        {data.roundOff != null && Math.abs(data.roundOff) >= 0.005 ? (
          <View style={s.tableRow}>
            <Text style={[s.cell, { width: "84%" }]}>Round Off</Text>
            <Text style={[s.cellLast, s.right, { width: "16%" }]}>
              {formatINRPlain(data.roundOff)}
            </Text>
          </View>
        ) : null}
        <View style={[s.tableRow, { fontFamily: "Helvetica-Bold" }]}>
          <Text style={[s.cell, { width: "84%" }]}>Grand Total</Text>
          <Text style={[s.cellLast, s.right, { width: "16%" }]}>
            {formatINRPlain(data.grandTotal)}
          </Text>
        </View>

        <View style={{ marginTop: 12 }}>
          <Text style={s.label}>Amount Chargeable (in words)</Text>
          <Text>{amountInWordsINR(data.grandTotal)}</Text>
        </View>

        {data.remarks ? (
          <View style={{ marginTop: 10 }}>
            <Text style={s.label}>Remarks</Text>
            <Text>{data.remarks}</Text>
          </View>
        ) : null}

        <View
          style={{
            marginTop: 40,
            flexDirection: "row",
            justifyContent: "flex-end",
          }}
        >
          <View style={{ width: 180, alignItems: "center" }}>
            <Text style={{ marginBottom: 36 }}>for {data.seller.legalName}</Text>
            <Text style={s.label}>Authorised Signatory</Text>
          </View>
        </View>

        <Text style={s.footer}>
          {docType === "PROFORMA"
            ? "Computer Generated Proforma — Not a Tax Invoice"
            : "This is a Computer Generated Invoice"}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfInput): Promise<Buffer> {
  const logoPath =
    data.logoPath ||
    path.join(process.cwd(), "public", "brand", "logo.png");
  const instance = pdf(<InvoiceDoc data={{ ...data, logoPath }} />);
  const blob = await instance.toBlob();
  const ab = await blob.arrayBuffer();
  return Buffer.from(ab);
}
