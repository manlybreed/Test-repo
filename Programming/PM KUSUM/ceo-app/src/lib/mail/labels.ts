import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";

function sanitizeLabelName(name: string): string {
  const clean = name
    .trim()
    .replace(/[/\.]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 48);
  if (!clean) throw new Error("Label name required");
  if (/^(inbox|sent|drafts?|trash|junk|spam|archive)$/i.test(clean)) {
    throw new Error("That name is reserved for a system mailbox");
  }
  return clean;
}

async function connectImap() {
  const cfg = getCeoMailConfig();
  if (!cfg) throw new Error("CEO mail not configured");
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.imapPort,
    secure: cfg.imapSecure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  await client.connect();
  return client;
}

/** Create an IMAP mailbox that acts as a custom label + DB folder row. */
export async function createMailLabel(opts: {
  accountId: string;
  name: string;
}) {
  const name = sanitizeLabelName(opts.name);
  const pathName = name;

  const existing = await prisma.mailFolder.findFirst({
    where: {
      accountId: opts.accountId,
      OR: [
        { path: pathName },
        { name: { equals: name, mode: "insensitive" } },
      ],
    },
  });
  if (existing) return existing;

  const client = await connectImap();
  try {
    try {
      await client.mailboxCreate(pathName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists|exists/i.test(msg)) throw e;
    }

    return prisma.mailFolder.upsert({
      where: {
        accountId_path: { accountId: opts.accountId, path: pathName },
      },
      create: {
        accountId: opts.accountId,
        path: pathName,
        name,
        role: "OTHER",
      },
      update: { name, role: "OTHER" },
    });
  } finally {
    await client.logout().catch(() => undefined);
  }
}
