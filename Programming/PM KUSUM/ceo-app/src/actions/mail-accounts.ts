"use server";

import { revalidatePath } from "next/cache";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { requireCeoAction as requireCeo } from "@/lib/session";
import { auth } from "@/lib/auth";
import {
  ensureCeoMailAccount,
  createMailAccountShell,
  requireOwnedAccount,
} from "@/lib/mail/account";
import { encryptSecret } from "@/lib/mail/credential-crypto";
import { syncCeoMail } from "@/lib/mail/sync";

function revalidateMail() {
  revalidatePath("/ceo/mail");
}

async function requireSession() {
  await requireCeo();
  const session = await auth();
  if (!session?.user?.id) throw new Error("Session expired — please refresh and log in again.");
  return session.user.id;
}

export type MailboxCredentialsInput = {
  host: string;
  imapPort: number;
  imapSecure: boolean;
  smtpPort: number;
  smtpSecure: boolean;
  sievePort?: number;
  username: string;
  password: string;
};

export type MailAccountSummary = {
  id: string;
  address: string;
  displayName: string | null;
  credentialKey: string;
  isPrimary: boolean;
};

function toSummary(a: {
  id: string;
  address: string;
  displayName: string | null;
  credentialKey: string;
}): MailAccountSummary {
  return {
    id: a.id,
    address: a.address,
    displayName: a.displayName,
    credentialKey: a.credentialKey,
    isPrimary: a.credentialKey === "ceo_env",
  };
}

/** Every mailbox (env-configured primary + any added via settings) the session user owns. */
export async function listMailAccountsAction(): Promise<MailAccountSummary[]> {
  const userId = await requireSession();
  // Make sure the primary env-based mailbox exists/links to this user too,
  // same as the main mail page's own bootstrap already does.
  await ensureCeoMailAccount(userId).catch(() => null);

  const accounts = await prisma.mailAccount.findMany({
    where: { userId },
    orderBy: [{ credentialKey: "asc" }, { createdAt: "asc" }],
    select: { id: true, address: true, displayName: true, credentialKey: true },
  });
  return accounts.map(toSummary);
}

/** Attempts a real IMAP connect + SMTP verify with the given credentials. Persists nothing. */
export async function testMailConnectionAction(
  input: MailboxCredentialsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireCeo();

  let imapClient: ImapFlow | null = null;
  try {
    imapClient = new ImapFlow({
      host: input.host,
      port: input.imapPort,
      secure: input.imapSecure,
      auth: { user: input.username, pass: input.password },
      logger: false,
    });
    await imapClient.connect();
  } catch (e) {
    return { ok: false, error: `IMAP: ${e instanceof Error ? e.message : "connection failed"}` };
  } finally {
    await imapClient?.logout().catch(() => undefined);
  }

  try {
    const transport = nodemailer.createTransport({
      host: input.host,
      port: input.smtpPort,
      secure: input.smtpSecure,
      auth: { user: input.username, pass: input.password },
    });
    await transport.verify();
  } catch (e) {
    return { ok: false, error: `SMTP: ${e instanceof Error ? e.message : "connection failed"}` };
  }

  return { ok: true };
}

/** Adds a new mailbox: MailAccount + encrypted MailAccountCredential + defaults, then kicks off a first sync. */
export async function addMailAccountAction(
  input: MailboxCredentialsInput & { address: string; displayName?: string },
): Promise<MailAccountSummary> {
  const userId = await requireSession();

  const address = input.address.trim().toLowerCase();
  if (!address || !address.includes("@")) throw new Error("A valid email address is required");

  const existing = await prisma.mailAccount.findUnique({ where: { address } });
  if (existing) throw new Error(`${address} is already configured`);

  const account = await createMailAccountShell({
    address,
    displayName: input.displayName?.trim() || null,
    userId,
  });

  await prisma.mailAccountCredential.create({
    data: {
      accountId: account.id,
      host: input.host,
      imapPort: input.imapPort,
      imapSecure: input.imapSecure,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      sievePort: input.sievePort ?? 4190,
      username: input.username,
      passwordEncrypted: encryptSecret(input.password),
    },
  });

  // Best-effort first sync so the mailbox has data as soon as it's added —
  // failure here doesn't undo the mailbox, it just stays empty until the
  // user retries (same as a transient sync failure on any other mailbox).
  void syncCeoMail({ accountId: account.id, maxTriageNew: 8 }).catch(() => undefined);

  revalidateMail();
  return toSummary(account);
}

/** Updates a non-primary mailbox's display name and/or connection details. */
export async function updateMailAccountAction(input: {
  accountId: string;
  displayName?: string;
  host?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpPort?: number;
  smtpSecure?: boolean;
  sievePort?: number;
  username?: string;
  /** Only re-encrypted/updated when provided — leave blank to keep the current password. */
  password?: string;
}): Promise<MailAccountSummary> {
  const userId = await requireSession();
  const account = await requireOwnedAccount(input.accountId, userId);
  if (account.credentialKey === "ceo_env") {
    throw new Error("The primary mailbox's connection is configured via environment variables, not here.");
  }

  if (input.displayName !== undefined) {
    await prisma.mailAccount.update({
      where: { id: account.id },
      data: { displayName: input.displayName.trim() || null },
    });
  }

  const hasConnectionChange =
    input.host !== undefined ||
    input.imapPort !== undefined ||
    input.imapSecure !== undefined ||
    input.smtpPort !== undefined ||
    input.smtpSecure !== undefined ||
    input.sievePort !== undefined ||
    input.username !== undefined ||
    input.password !== undefined;

  if (hasConnectionChange) {
    const cred = await prisma.mailAccountCredential.findUnique({
      where: { accountId: account.id },
    });
    if (!cred) throw new Error("Mailbox credentials not found");
    await prisma.mailAccountCredential.update({
      where: { accountId: account.id },
      data: {
        host: input.host ?? cred.host,
        imapPort: input.imapPort ?? cred.imapPort,
        imapSecure: input.imapSecure ?? cred.imapSecure,
        smtpPort: input.smtpPort ?? cred.smtpPort,
        smtpSecure: input.smtpSecure ?? cred.smtpSecure,
        sievePort: input.sievePort ?? cred.sievePort,
        username: input.username ?? cred.username,
        passwordEncrypted: input.password
          ? encryptSecret(input.password)
          : cred.passwordEncrypted,
      },
    });
  }

  revalidateMail();
  const updated = await prisma.mailAccount.findUniqueOrThrow({ where: { id: account.id } });
  return toSummary(updated);
}

/** Removes a non-primary mailbox and everything scoped to it (cascades). */
export async function removeMailAccountAction(accountId: string): Promise<{ ok: true }> {
  const userId = await requireSession();
  const account = await requireOwnedAccount(accountId, userId);
  if (account.credentialKey === "ceo_env") {
    throw new Error("The primary mailbox can't be removed here.");
  }

  await prisma.mailAccount.delete({ where: { id: account.id } });
  revalidateMail();
  return { ok: true };
}
