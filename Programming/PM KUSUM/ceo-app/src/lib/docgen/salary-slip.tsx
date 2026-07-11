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
import { amountInWordsINR, formatINRPlain, monthName } from "@/lib/utils";

export type SalarySlipPdfInput = {
  companyName: string;
  companyAddress: string;
  companyGstin?: string;
  employeeName: string;
  employeeCode?: string | null;
  designation?: string | null;
  department?: string | null;
  emailOfficial?: string | null;
  phone?: string | null;
  pan?: string | null;
  uan?: string | null;
  month: number;
  year: number;
  basic: number;
  hra: number;
  special: number;
  otherAllow: number;
  gross: number;
  pf: number;
  professionalTax: number;
  tds: number;
  otherDeduct: number;
  totalDeduct: number;
  netPay: number;
  logoPath?: string;
};

const s = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0b1f3a",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1a3a6b",
    paddingBottom: 12,
  },
  company: { fontSize: 14, fontFamily: "Helvetica-Bold", color: "#0b1f3a" },
  muted: { color: "#445", fontSize: 8, marginTop: 2 },
  title: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    marginVertical: 12,
    letterSpacing: 1,
  },
  row: { flexDirection: "row", marginBottom: 4 },
  col: { width: "50%" },
  label: { color: "#556", fontSize: 8 },
  value: { fontFamily: "Helvetica-Bold", marginTop: 1 },
  table: { marginTop: 14, borderWidth: 1, borderColor: "#1a3a6b" },
  th: {
    flexDirection: "row",
    backgroundColor: "#0b1f3a",
    color: "#fff",
    fontFamily: "Helvetica-Bold",
  },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#ccd" },
  td: { padding: 6, width: "50%" },
  right: { textAlign: "right" },
  net: {
    marginTop: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#1a3a6b",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function SlipDoc({ data }: { data: SalarySlipPdfInput }) {
  const earnings = [
    ["Basic", data.basic],
    ["HRA", data.hra],
    ["Special Allowance", data.special],
    ["Other Allowances", data.otherAllow],
  ];
  const deductions = [
    ["Provident Fund", data.pf],
    ["Professional Tax", data.professionalTax],
    ["TDS", data.tds],
    ["Other Deductions", data.otherDeduct],
  ];

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.company}>{data.companyName}</Text>
            <Text style={s.muted}>{data.companyAddress}</Text>
            {data.companyGstin ? (
              <Text style={s.muted}>GSTIN: {data.companyGstin}</Text>
            ) : null}
          </View>
          {data.logoPath ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={data.logoPath} style={{ width: 90, height: 30 }} />
          ) : null}
        </View>

        <Text style={s.title}>
          SALARY SLIP — {monthName(data.month).toUpperCase()} {data.year}
        </Text>

        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Employee</Text>
            <Text style={s.value}>{data.employeeName}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Employee Code</Text>
            <Text style={s.value}>{data.employeeCode || "—"}</Text>
          </View>
        </View>
        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Designation</Text>
            <Text style={s.value}>{data.designation || "—"}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Department</Text>
            <Text style={s.value}>{data.department || "—"}</Text>
          </View>
        </View>
        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>Corporate email</Text>
            <Text style={s.value}>{data.emailOfficial || "—"}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Phone</Text>
            <Text style={s.value}>{data.phone || "—"}</Text>
          </View>
        </View>
        <View style={s.row}>
          <View style={s.col}>
            <Text style={s.label}>PAN</Text>
            <Text style={s.value}>{data.pan || "—"}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>UAN</Text>
            <Text style={s.value}>{data.uan || "—"}</Text>
          </View>
        </View>

        <View style={[s.row, { marginTop: 10 }]}>
          <View style={[s.table, { width: "48%", marginRight: "4%" }]}>
            <View style={s.th}>
              <Text style={[s.td, { color: "#fff" }]}>Earnings</Text>
              <Text style={[s.td, s.right, { color: "#fff" }]}>Amount (₹)</Text>
            </View>
            {earnings.map(([label, amt]) => (
              <View key={String(label)} style={s.tr}>
                <Text style={s.td}>{label}</Text>
                <Text style={[s.td, s.right]}>{formatINRPlain(Number(amt))}</Text>
              </View>
            ))}
            <View style={[s.tr, { fontFamily: "Helvetica-Bold" }]}>
              <Text style={s.td}>Gross</Text>
              <Text style={[s.td, s.right]}>{formatINRPlain(data.gross)}</Text>
            </View>
          </View>

          <View style={[s.table, { width: "48%" }]}>
            <View style={s.th}>
              <Text style={[s.td, { color: "#fff" }]}>Deductions</Text>
              <Text style={[s.td, s.right, { color: "#fff" }]}>Amount (₹)</Text>
            </View>
            {deductions.map(([label, amt]) => (
              <View key={String(label)} style={s.tr}>
                <Text style={s.td}>{label}</Text>
                <Text style={[s.td, s.right]}>{formatINRPlain(Number(amt))}</Text>
              </View>
            ))}
            <View style={[s.tr, { fontFamily: "Helvetica-Bold" }]}>
              <Text style={s.td}>Total Deductions</Text>
              <Text style={[s.td, s.right]}>
                {formatINRPlain(data.totalDeduct)}
              </Text>
            </View>
          </View>
        </View>

        <View style={s.net}>
          <View>
            <Text style={s.label}>Net Pay</Text>
            <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold" }}>
              ₹ {formatINRPlain(data.netPay)}
            </Text>
            <Text style={[s.muted, { marginTop: 4 }]}>
              {amountInWordsINR(data.netPay)}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", justifyContent: "flex-end" }}>
            <Text style={s.muted}>Authorised Signatory</Text>
          </View>
        </View>

        <Text style={[s.muted, { marginTop: 24 }]}>
          This is a computer-generated salary slip.
        </Text>
      </Page>
    </Document>
  );
}

export async function renderSalarySlipPdf(
  data: SalarySlipPdfInput,
): Promise<Buffer> {
  const logoPath =
    data.logoPath ||
    path.join(process.cwd(), "public", "brand", "logo.png");
  const instance = pdf(<SlipDoc data={{ ...data, logoPath }} />);
  const blob = await instance.toBlob();
  return Buffer.from(await blob.arrayBuffer());
}
