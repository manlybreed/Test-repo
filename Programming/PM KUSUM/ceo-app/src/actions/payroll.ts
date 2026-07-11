"use server";

import path from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { writeStorageFile } from "@/lib/storage";
import { amountInWordsINR } from "@/lib/utils";
import { renderSalarySlipPdf } from "@/lib/docgen/salary-slip";
import { employeeSalaryTotals } from "@/lib/employee-salary";
import { formatAadhaar } from "@/lib/indian-states";

export async function nextEmployeeCode(): Promise<string> {
  await requireCeo();
  const employees = await prisma.employee.findMany({
    select: { employeeCode: true },
  });
  let max = 0;
  for (const e of employees) {
    const m = e.employeeCode?.match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `BR-${String(max + 1).padStart(3, "0")}`;
}

export type EmployeeInput = {
  id?: string;
  name: string;
  employeeCode?: string;
  designation?: string;
  department?: string;
  email?: string;
  emailOfficial?: string;
  phone: string;
  pan?: string;
  aadhaar?: string;
  uan?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  pincode?: string;
  bankAccount?: string;
  bankIfsc?: string;
  bankName?: string;
  bankBranch?: string;
  basic: number;
  hra?: number;
  special?: number;
  otherAllow?: number;
  pf?: number;
  professionalTax?: number;
  tdsPercent?: number;
  otherDeduct?: number;
  joinDate?: string;
  dateOfBirth?: string;
  photoPath?: string;
  panDocPath?: string;
  aadhaarDocPath?: string;
  agreementPath?: string;
  bankDocPath?: string;
  salarySlipPath?: string;
  notes?: string;
  rawExtract?: string;
  active?: boolean;
};

export async function upsertEmployee(input: EmployeeInput) {
  await requireCeo();
  if (!input.name?.trim()) throw new Error("Name is required");
  if (!input.phone?.trim()) throw new Error("Contact number is required");
  if (!input.emailOfficial?.trim()) {
    throw new Error("Corporate / official email is required");
  }
  if (input.basic == null || Number.isNaN(Number(input.basic))) {
    throw new Error("Basic salary is required");
  }

  let code = input.employeeCode?.trim() || null;
  if (!input.id && !code) {
    const employees = await prisma.employee.findMany({ select: { employeeCode: true } });
    let max = 0;
    for (const e of employees) {
      const m = e.employeeCode?.match(/(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    code = `BR-${String(max + 1).padStart(3, "0")}`;
  }

  const data = {
    name: input.name.trim(),
    employeeCode: code,
    designation: input.designation || null,
    department: input.department || null,
    email: input.email || null,
    emailOfficial: input.emailOfficial.trim(),
    phone: input.phone.trim(),
    pan: input.pan?.toUpperCase() || null,
    aadhaar: input.aadhaar ? formatAadhaar(input.aadhaar) || null : null,
    uan: input.uan || null,
    addressLine1: input.addressLine1 || null,
    city: input.city || null,
    state: input.state || null,
    pincode: input.pincode || null,
    bankAccount: input.bankAccount || null,
    bankIfsc: input.bankIfsc?.toUpperCase() || null,
    bankName: input.bankName || null,
    bankBranch: input.bankBranch || null,
    basic: Number(input.basic),
    hra: input.hra ?? 0,
    special: input.special ?? 0,
    otherAllow: input.otherAllow ?? 0,
    pf: input.pf ?? 0,
    professionalTax: input.professionalTax ?? 0,
    tdsPercent: input.tdsPercent ?? 0,
    otherDeduct: input.otherDeduct ?? 0,
    joinDate: input.joinDate ? new Date(input.joinDate) : null,
    dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
    photoPath: input.photoPath || null,
    panDocPath: input.panDocPath || null,
    aadhaarDocPath: input.aadhaarDocPath || null,
    agreementPath: input.agreementPath || null,
    bankDocPath: input.bankDocPath || null,
    salarySlipPath: input.salarySlipPath || null,
    notes: input.notes || null,
    rawExtract: input.rawExtract || null,
    active: input.active ?? true,
  };

  const employee = input.id
    ? await prisma.employee.update({ where: { id: input.id }, data })
    : await prisma.employee.create({ data });

  revalidatePath("/ceo/payroll");
  revalidatePath("/ceo/employees");
  return employee;
}

export async function createEmployee(input: EmployeeInput) {
  const { id: _id, ...rest } = input;
  return upsertEmployee(rest);
}

export async function deleteEmployee(id: string) {
  await requireCeo();
  if (!id) throw new Error("Employee ID required");
  await prisma.employee.delete({ where: { id } });
  revalidatePath("/ceo/payroll");
  revalidatePath("/ceo/employees");
}

export async function listEmployees() {
  await requireCeo();
  return prisma.employee.findMany({ orderBy: { name: "asc" } });
}

export async function generateSalarySlip(input: {
  employeeId: string;
  month: number;
  year: number;
}) {
  await requireCeo();
  const employee = await prisma.employee.findUniqueOrThrow({
    where: { id: input.employeeId },
  });
  const company = await prisma.companyProfile.findFirst();
  if (!company) throw new Error("Company profile not seeded");

  const basic = employee.basic;
  const hra = employee.hra;
  const special = employee.special;
  const otherAllow = employee.otherAllow;
  const pf = employee.pf;
  const professionalTax = employee.professionalTax;
  const otherDeduct = employee.otherDeduct;
  const { gross, tdsAmount, totalDeduct, netPay } = employeeSalaryTotals({
    basic,
    hra,
    special,
    otherAllow,
    pf,
    professionalTax,
    tdsPercent: employee.tdsPercent,
    otherDeduct,
  });

  const pdfBuf = await renderSalarySlipPdf({
    companyName: company.legalName,
    companyAddress: `${company.addressLine1}, ${company.city}, ${company.state}`,
    companyGstin: company.gstin,
    employeeName: employee.name,
    employeeCode: employee.employeeCode,
    designation: employee.designation,
    department: employee.department,
    emailOfficial: employee.emailOfficial,
    phone: employee.phone,
    pan: employee.pan,
    uan: employee.uan,
    month: input.month,
    year: input.year,
    basic,
    hra,
    special,
    otherAllow,
    gross,
    pf,
    professionalTax,
    tds: tdsAmount,
    otherDeduct,
    totalDeduct,
    netPay,
    logoPath: path.join(process.cwd(), "public", "brand", "logo.png"),
  });

  const code = employee.employeeCode || employee.name.replace(/\s+/g, "_");
  const filename = `Salary_${code}_${input.year}_${String(input.month).padStart(2, "0")}.pdf`;
  const filePath = await writeStorageFile("salary-slips", filename, pdfBuf);

  const slip = await prisma.salarySlip.upsert({
    where: {
      employeeId_month_year: {
        employeeId: employee.id,
        month: input.month,
        year: input.year,
      },
    },
    create: {
      employeeId: employee.id,
      month: input.month,
      year: input.year,
      basic,
      hra,
      special,
      otherAllow,
      gross,
      pf,
      professionalTax,
      tds: tdsAmount,
      otherDeduct,
      totalDeduct,
      netPay,
      amountInWords: amountInWordsINR(netPay),
      filePath,
    },
    update: {
      basic,
      hra,
      special,
      otherAllow,
      gross,
      pf,
      professionalTax,
      tds: tdsAmount,
      otherDeduct,
      totalDeduct,
      netPay,
      amountInWords: amountInWordsINR(netPay),
      filePath,
    },
  });

  revalidatePath("/ceo/payroll");
  return { id: slip.id, filePath, netPay, employeeName: employee.name };
}

export async function listSalarySlips() {
  await requireCeo();
  return prisma.salarySlip.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { employee: true },
  });
}

export async function generateSlipsForMonth(month: number, year: number) {
  await requireCeo();
  const employees = await prisma.employee.findMany({ where: { active: true } });
  const results = [];
  for (const emp of employees) {
    results.push(
      await generateSalarySlip({ employeeId: emp.id, month, year }),
    );
  }
  return results;
}
