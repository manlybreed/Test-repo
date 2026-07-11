import { PrismaClient } from "@prisma/client";

/** Bump when Prisma schema fields change so the next.js global singleton is recreated in dev. */
const PRISMA_SCHEMA_STAMP = "salary-payment-v2";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaStamp?: string;
};

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getClient() {
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaSchemaStamp === PRISMA_SCHEMA_STAMP
  ) {
    return globalForPrisma.prisma;
  }
  // Drop stale cached client after schema changes (e.g. dateOfBirth added)
  void globalForPrisma.prisma?.$disconnect().catch(() => undefined);
  const client = createClient();
  globalForPrisma.prisma = client;
  globalForPrisma.prismaSchemaStamp = PRISMA_SCHEMA_STAMP;
  return client;
}

export const prisma = getClient();
