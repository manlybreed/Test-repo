"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";

export type ClientInput = {
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  pocName?: string;
  notes?: string;
};

function clientData(input: ClientInput) {
  return {
    name: input.name.trim(),
    addressLine1: input.addressLine1 || null,
    addressLine2: input.addressLine2 || null,
    city: input.city || null,
    state: input.state || null,
    stateCode: input.stateCode || null,
    pincode: input.pincode || null,
    gstin: input.gstin || null,
    pan: input.pan || null,
    email: input.email || null,
    phone: input.phone || null,
    pocName: input.pocName?.trim() || null,
    notes: input.notes || null,
  };
}

function revalidateClients() {
  revalidatePath("/ceo/invoices");
  revalidatePath("/ceo/agreements");
  revalidatePath("/ceo/clients");
}

export async function createClient(input: ClientInput) {
  await requireCeo();
  if (!input.name?.trim()) throw new Error("Client name is required");
  const client = await prisma.client.create({ data: clientData(input) });
  revalidateClients();
  return client;
}

export async function updateClient(id: string, input: ClientInput) {
  await requireCeo();
  if (!input.name?.trim()) throw new Error("Client name is required");
  const client = await prisma.client.update({
    where: { id },
    data: clientData(input),
  });
  revalidateClients();
  return client;
}

export async function updateClientPoc(
  clientId: string,
  input: { pocName?: string | null; phone?: string | null },
) {
  await requireCeo();
  const client = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(input.pocName !== undefined
        ? { pocName: input.pocName?.trim() || null }
        : {}),
      ...(input.phone !== undefined
        ? { phone: input.phone?.trim() || null }
        : {}),
    },
  });
  revalidateClients();
  return client;
}

export async function deleteClient(id: string) {
  await requireCeo();
  const [agreements, invoices] = await Promise.all([
    prisma.agreement.count({ where: { clientId: id } }),
    prisma.invoice.count({ where: { clientId: id } }),
  ]);
  if (agreements > 0 || invoices > 0) {
    throw new Error(
      `Cannot delete: ${agreements} agreement(s) and ${invoices} invoice(s) still linked. Remove or reassign them first.`,
    );
  }
  await prisma.client.delete({ where: { id } });
  revalidateClients();
  return { ok: true };
}

export async function listClients() {
  await requireCeo();
  return prisma.client.findMany({ orderBy: { name: "asc" } });
}

/** Clients with agreement counts for the Clients / Agreements UX. */
export async function listClientsWithAgreements() {
  await requireCeo();
  const clients = await prisma.client.findMany({
    orderBy: { name: "asc" },
    include: {
      agreements: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          status: true,
          effectiveDate: true,
          filePath: true,
          spvName: true,
          createdAt: true,
        },
      },
      _count: { select: { invoices: true } },
    },
  });
  return clients.map((c) => ({
    ...c,
    agreementCount: c.agreements.length,
    invoiceCount: c._count.invoices,
  }));
}
