import { PrismaClient } from "@prisma/client";

/**
 * Bump when Prisma schema models/fields change so the Next.js global
 * singleton is dropped. Also validates that expected delegates exist —
 * a process that loaded @prisma/client before `prisma generate` will
 * still construct a client missing new models until the server restarts.
 */
const PRISMA_SCHEMA_STAMP = "ai-email-client-v2";

const REQUIRED_MODELS = [
  "kusumPlant",
  "docTypeCatalog",
  "plantParty",
  "plantDocRequirement",
  "plantFileComment",
  "plantTask",
  "appSetting",
  "outwardSupplyEntry",
  "inwardSupplyEntry",
  "itcLedgerEntry",
  "advanceLedgerEntry",
  "stockLedgerEntry",
  "auditLog",
  "mailAccount",
  "mailFolder",
  "mailThread",
  "mailMessage",
  "mailOutbox",
  "mailSignature",
] as const;

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaStamp?: string;
};

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function clientHasModel(client: PrismaClient, model: string): boolean {
  return typeof (client as unknown as Record<string, unknown>)[model] === "object";
}

function missingModels(client: PrismaClient): string[] {
  return REQUIRED_MODELS.filter((m) => !clientHasModel(client, m));
}

function getClient(): PrismaClient {
  const cached = globalForPrisma.prisma;
  if (
    cached &&
    globalForPrisma.prismaSchemaStamp === PRISMA_SCHEMA_STAMP &&
    missingModels(cached).length === 0
  ) {
    return cached;
  }

  void cached?.$disconnect().catch(() => undefined);
  const client = createClient();
  const missing = missingModels(client);
  if (missing.length) {
    throw new Error(
      `Prisma client is missing: ${missing.join(", ")}. Stop the Next.js dev server, run \`npx prisma generate\`, then start it again.`,
    );
  }

  globalForPrisma.prisma = client;
  globalForPrisma.prismaSchemaStamp = PRISMA_SCHEMA_STAMP;
  return client;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
