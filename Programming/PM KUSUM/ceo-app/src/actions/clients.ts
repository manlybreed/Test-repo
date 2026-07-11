"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";

export async function createClient(input: {
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
  notes?: string;
}) {
  await requireCeo();
  if (!input.name?.trim()) throw new Error("Client name is required");
  const client = await prisma.client.create({
    data: {
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
      notes: input.notes || null,
    },
  });
  revalidatePath("/ceo/invoices");
  revalidatePath("/ceo/agreements");
  return client;
}

export async function listClients() {
  await requireCeo();
  return prisma.client.findMany({ orderBy: { name: "asc" } });
}
