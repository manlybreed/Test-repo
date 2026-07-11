"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { writeStorageFile } from "@/lib/storage";
import { renderAgreementDocx } from "@/lib/docgen/agreement";

export type CreateAgreementInput = {
  clientId?: string;
  clientName: string;
  clientAddress?: string;
  clientGstin?: string;
  clientPan?: string;
  clientEmail?: string;
  clientMobile?: string;
  spvName?: string;
  plantCount?: number;
  tokenFeePerPlant?: number;
  successFeePct?: number;
  gstPct?: number;
  designatedLender?: string;
  loanType?: string;
  interestMin?: string;
  interestMax?: string;
  minLoan?: string;
  maxLoan?: string;
  tenure?: string;
  moratorium?: string;
  repaymentSchedule?: string;
  collateral?: string;
  plantCapacityAC?: string;
  plantCapacityDC?: string;
  tariff?: string;
  dprAmount?: string;
  effectiveDate?: string;
  status?: "DRAFT" | "FINAL";
};

export async function createAgreement(input: CreateAgreementInput) {
  await requireCeo();
  if (!input.clientName?.trim()) throw new Error("Client name is required");

  const effectiveDate = input.effectiveDate
    ? new Date(input.effectiveDate)
    : new Date();

  const payload = {
    clientName: input.clientName.trim(),
    clientAddress: input.clientAddress || null,
    clientGstin: input.clientGstin || null,
    clientPan: input.clientPan || null,
    spvName: input.spvName || null,
    plantCount: input.plantCount ?? 1,
    tokenFeePerPlant: input.tokenFeePerPlant ?? 40000,
    successFeePct: input.successFeePct ?? 1,
    gstPct: input.gstPct ?? 18,
    designatedLender: input.designatedLender || null,
    effectiveDate,
    termMonths: 9,
    tailMonths: 24,
  };

  const status = input.status ?? "FINAL";

  const agreement = await prisma.agreement.create({
    data: {
      ...payload,
      clientId: input.clientId || null,
      status,
      inputsJson: { ...input, effectiveDate: effectiveDate.toISOString() },
    },
  });

  const docx = await renderAgreementDocx({
    ...input,
    clientName: input.clientName.trim(),
    effectiveDate,
  });

  const slug = input.clientName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const filename = `Agreement_${slug}_${agreement.id.slice(-6)}.docx`;
  const filePath = await writeStorageFile("agreements", filename, docx);

  await prisma.agreement.update({
    where: { id: agreement.id },
    data: { filePath },
  });

  await prisma.agreementVersion.create({
    data: {
      agreementId: agreement.id,
      version: 1,
      filePath,
      inputsJson: input,
    },
  });

  revalidatePath("/ceo/agreements");
  revalidatePath("/ceo");
  return { id: agreement.id, filePath, clientName: agreement.clientName };
}

export async function listAgreements() {
  await requireCeo();
  return prisma.agreement.findMany({
    orderBy: { createdAt: "desc" },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
}

export async function finalizeAgreement(id: string) {
  await requireCeo();
  await prisma.agreement.update({
    where: { id },
    data: { status: "FINAL" },
  });
  revalidatePath("/ceo/agreements");
}
