"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireFinanceOwnerAction as requireCeo } from "@/lib/session";
import { writeStorageFile, deleteStorageFile } from "@/lib/storage";
import { renderAgreementDocx } from "@/lib/docgen/agreement";
import { inferAgreementFeesFromFile } from "@/lib/agreements/infer-fees";

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

export async function updateAgreement(id: string, input: CreateAgreementInput) {
  await requireCeo();
  if (!input.clientName?.trim()) throw new Error("Client name is required");

  const existing = await prisma.agreement.findUniqueOrThrow({
    where: { id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  const effectiveDate = input.effectiveDate
    ? new Date(input.effectiveDate)
    : existing.effectiveDate;

  const payload = {
    clientName: input.clientName.trim(),
    clientAddress: input.clientAddress || null,
    clientGstin: input.clientGstin || null,
    clientPan: input.clientPan || null,
    spvName: input.spvName || null,
    plantCount: input.plantCount ?? existing.plantCount,
    tokenFeePerPlant: input.tokenFeePerPlant ?? existing.tokenFeePerPlant,
    successFeePct: input.successFeePct ?? existing.successFeePct,
    gstPct: input.gstPct ?? existing.gstPct,
    designatedLender: input.designatedLender || null,
    effectiveDate,
    status: input.status ?? existing.status,
    clientId: input.clientId || existing.clientId,
    inputsJson: { ...input, effectiveDate: effectiveDate.toISOString() },
  };

  const docx = await renderAgreementDocx({
    ...input,
    clientName: input.clientName.trim(),
    effectiveDate,
  });

  const slug = input.clientName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const nextVersion = (existing.versions[0]?.version ?? 0) + 1;
  const filename = `Agreement_${slug}_${id.slice(-6)}_v${nextVersion}.docx`;
  const filePath = await writeStorageFile("agreements", filename, docx);

  const agreement = await prisma.agreement.update({
    where: { id },
    data: { ...payload, filePath },
  });

  await prisma.agreementVersion.create({
    data: {
      agreementId: id,
      version: nextVersion,
      filePath,
      inputsJson: input,
    },
  });

  // Keep prior DOCX files on disk via version history; only swap current pointer.
  revalidatePath("/ceo/agreements");
  revalidatePath("/ceo");
  revalidatePath("/ceo/clients");
  return { id: agreement.id, filePath, clientName: agreement.clientName };
}

export async function deleteAgreement(id: string) {
  await requireCeo();
  const agreement = await prisma.agreement.findUniqueOrThrow({
    where: { id },
    include: { versions: { select: { filePath: true } } },
  });
  const paths = new Set<string>();
  if (agreement.filePath) paths.add(agreement.filePath);
  for (const v of agreement.versions) {
    if (v.filePath) paths.add(v.filePath);
  }
  await prisma.agreement.delete({ where: { id } });
  for (const p of paths) {
    await deleteStorageFile(p);
  }
  revalidatePath("/ceo/agreements");
  revalidatePath("/ceo");
  revalidatePath("/ceo/clients");
  return { ok: true };
}

export async function getAgreementForEdit(id: string) {
  await requireCeo();
  return prisma.agreement.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
}

export async function uploadAgreementFile(formData: FormData) {
  await requireCeo();
  const agreementId = String(formData.get("agreementId") || "");
  const file = formData.get("file") as File | null;
  if (!agreementId) throw new Error("Agreement id required");
  if (!file || file.size === 0) throw new Error("File required");

  const existing = await prisma.agreement.findUniqueOrThrow({
    where: { id: agreementId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() || "docx").toLowerCase();
  const allowed = new Set(["pdf", "docx", "doc"]);
  if (!allowed.has(ext)) {
    throw new Error("Upload a PDF or Word file (.pdf, .docx, .doc)");
  }

  let inferred;
  try {
    inferred = await inferAgreementFeesFromFile({
      buffer: buf,
      ext,
      fileName: file.name,
    });
  } catch (err) {
    console.error("[uploadAgreementFile] fee inference failed", err);
    inferred = {
      tokenFeePerPlant: null,
      successFeePct: null,
      plantCount: null,
      tokenFeeCandidates: [] as number[],
      successFeeCandidates: [] as number[],
      notes:
        "Fee inference failed — fees left unchanged. Re-upload or edit manually.",
      rawExtract: null,
    };
  }

  const slug = existing.clientName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const nextVersion = (existing.versions[0]?.version ?? 0) + 1;
  const filename = `Agreement_${slug}_${agreementId.slice(-6)}_v${nextVersion}_upload.${ext}`;
  const filePath = await writeStorageFile("agreements", filename, buf);

  const priorInputs =
    existing.inputsJson && typeof existing.inputsJson === "object"
      ? (existing.inputsJson as Record<string, unknown>)
      : {};

  await prisma.agreement.update({
    where: { id: agreementId },
    data: {
      filePath,
      isImported: true,
      tokenFeePerPlant:
        inferred.tokenFeePerPlant ?? existing.tokenFeePerPlant,
      successFeePct: inferred.successFeePct ?? existing.successFeePct,
      plantCount: inferred.plantCount ?? existing.plantCount,
      notes: inferred.notes ?? existing.notes,
      inputsJson: {
        ...priorInputs,
        uploaded: true,
        isImported: true,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        feeInference: {
          tokenFeeCandidates: inferred.tokenFeeCandidates,
          successFeeCandidates: inferred.successFeeCandidates,
          rawExtract: inferred.rawExtract,
        },
      },
    },
  });

  await prisma.agreementVersion.create({
    data: {
      agreementId,
      version: nextVersion,
      filePath,
      inputsJson: {
        uploaded: true,
        isImported: true,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        feeInference: {
          tokenFeePerPlant: inferred.tokenFeePerPlant,
          successFeePct: inferred.successFeePct,
          plantCount: inferred.plantCount,
          notes: inferred.notes,
          tokenFeeCandidates: inferred.tokenFeeCandidates,
          successFeeCandidates: inferred.successFeeCandidates,
        },
        previousInputs: existing.inputsJson ?? null,
      },
    },
  });

  revalidatePath("/ceo/agreements");
  revalidatePath("/ceo");
  revalidatePath("/ceo/clients");
  return { id: agreementId, filePath, version: nextVersion };
}

export async function createAgreementFromUpload(formData: FormData) {
  await requireCeo();
  const clientId = String(formData.get("clientId") || "").trim() || null;
  const clientName = String(formData.get("clientName") || "").trim();
  const spvName = String(formData.get("spvName") || "").trim() || null;
  const effectiveDateRaw = String(formData.get("effectiveDate") || "").trim();
  const statusRaw = String(formData.get("status") || "FINAL");
  const status = statusRaw === "DRAFT" ? "DRAFT" : "FINAL";
  const file = formData.get("file") as File | null;

  if (!clientName) throw new Error("Client name is required");
  if (!file || file.size === 0) throw new Error("Agreement file is required");

  const ext = (file.name.split(".").pop() || "docx").toLowerCase();
  const allowed = new Set(["pdf", "docx", "doc"]);
  if (!allowed.has(ext)) {
    throw new Error("Upload a PDF or Word file (.pdf, .docx, .doc)");
  }

  let clientAddress: string | null = null;
  let clientGstin: string | null = null;
  let clientPan: string | null = null;
  if (clientId) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (client) {
      clientAddress = [client.addressLine1, client.city, client.state]
        .filter(Boolean)
        .join(", ") || null;
      clientGstin = client.gstin;
      clientPan = client.pan;
    }
  }

  const effectiveDate = effectiveDateRaw
    ? new Date(effectiveDateRaw)
    : new Date();

  const buf = Buffer.from(await file.arrayBuffer());
  let inferred;
  try {
    inferred = await inferAgreementFeesFromFile({
      buffer: buf,
      ext,
      fileName: file.name,
    });
  } catch (err) {
    console.error("[createAgreementFromUpload] fee inference failed", err);
    inferred = {
      tokenFeePerPlant: null,
      successFeePct: null,
      plantCount: null,
      tokenFeeCandidates: [] as number[],
      successFeeCandidates: [] as number[],
      notes: "Fee inference failed — set fees manually via Edit.",
      rawExtract: null,
    };
  }

  const plantCount = inferred.plantCount && inferred.plantCount > 0
    ? inferred.plantCount
    : 1;
  const tokenFeePerPlant = inferred.tokenFeePerPlant ?? 0;
  const successFeePct = inferred.successFeePct ?? 0;

  const agreement = await prisma.agreement.create({
    data: {
      clientId,
      clientName,
      clientAddress,
      clientGstin,
      clientPan,
      spvName,
      effectiveDate,
      status,
      isImported: true,
      notes: inferred.notes,
      plantCount,
      tokenFeePerPlant,
      successFeePct,
      gstPct: 18,
      inputsJson: {
        uploaded: true,
        isImported: true,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        clientId,
        clientName,
        spvName,
        effectiveDate: effectiveDate.toISOString(),
        status,
        tokenFeePerPlant,
        successFeePct,
        plantCount,
        feeInference: {
          tokenFeeCandidates: inferred.tokenFeeCandidates,
          successFeeCandidates: inferred.successFeeCandidates,
          rawExtract: inferred.rawExtract,
        },
      },
    },
  });

  const slug = clientName
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const filename = `Agreement_${slug}_${agreement.id.slice(-6)}_upload.${ext}`;
  const filePath = await writeStorageFile("agreements", filename, buf);

  await prisma.agreement.update({
    where: { id: agreement.id },
    data: { filePath },
  });

  await prisma.agreementVersion.create({
    data: {
      agreementId: agreement.id,
      version: 1,
      filePath,
      inputsJson: {
        uploaded: true,
        isImported: true,
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
        feeInference: {
          tokenFeePerPlant,
          successFeePct,
          plantCount,
          notes: inferred.notes,
          tokenFeeCandidates: inferred.tokenFeeCandidates,
          successFeeCandidates: inferred.successFeeCandidates,
        },
      },
    },
  });

  revalidatePath("/ceo/agreements");
  revalidatePath("/ceo");
  revalidatePath("/ceo/clients");
  return {
    id: agreement.id,
    filePath,
    clientName,
    tokenFeePerPlant,
    successFeePct,
    notes: inferred.notes,
  };
}

export async function finalizeAgreement(id: string) {
  await requireCeo();
  await prisma.agreement.update({
    where: { id },
    data: { status: "FINAL" },
  });
  revalidatePath("/ceo/agreements");
}
