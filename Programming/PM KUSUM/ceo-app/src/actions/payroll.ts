"use server";

import path from "path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeo } from "@/lib/session";
import { writeStorageFile } from "@/lib/storage";
import { amountInWordsINR } from "@/lib/utils";
import { renderSalarySlipPdf } from "@/lib/docgen/salary-slip";

export async function upsertEmployee(input: {
  id?: string;
  name: string;
  employeeCode?: string;
  designation?: string;
  department?: string;
  email?: string;
  pan?: string;
  uan?: string;
  bankAccount?: string;
  bankIfsc?: string;
  basic: number;
  hra?: number;
  special?: number;
  otherAllow?: number;
  pf?: number;
  professionalTax?: number;
  tds?: number;
  otherDeduct?: number;
  active?: boolean;
}) {
  await requireCeo();
  if (!input.name?.trim()) throw new Error("Name is required");
  if (input.basic == null || Number.isNaN(input.basic)) {
    throw new Error("Basic salary is required");
  }

  const data = {
    name: input.name.trim(),
    employeeCode: input.employeeCode || null,
    designation: input.designation || null,
    department: input.department || null,
    email: input.email || null,
    pan: input.pan || null,
    uan: input.uan || null,
    bankAccount: input.bankAccount || null,
    bankIfsc: input.bankIfsc || null,
    basic: input.basic,
    hra: input.hra ?? 0,
    special: input.special ?? 0,
    otherAllow: input.otherAllow ?? 0,
    pf: input.pf ?? 0,
    professionalTax: input.professionalTax ?? 0,
    tds: input.tds ?? 0,
    otherDeduct: input.otherDeduct ?? 0,
    active: input.active ?? true,
  };

  const employee = input.id
    ? await prisma.employee.update({ where: { id: input.id }, data })
    : await prisma.employee.create({ data });

  revalidatePath("/ceo/payroll");
  return employee;
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
  const gross = basic + hra + special + otherAllow;
  const pf = employee.pf;
  const professionalTax = employee.professionalTax;
  const tds = employee.tds;
  const otherDeduct = employee.otherDeduct;
  const totalDeduct = pf + professionalTax + tds + otherDeduct;
  const netPay = gross - totalDeduct;

  const pdfBuf = await renderSalarySlipPdf({
    companyName: company.legalName,
    companyAddress: `${company.addressLine1}, ${company.city}, ${company.state}`,
    companyGstin: company.gstin,
    employeeName: employee.name,
    employeeCode: employee.employeeCode,
    designation: employee.designation,
    department: employee.department,
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
    tds,
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
      tds,
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
      tds,
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
