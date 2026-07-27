import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/mail/credential-crypto";

export type CeoMailConfig = {
  host: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapPort: number;
  imapSecure: boolean;
  sievePort: number;
  user: string;
  pass: string;
  from: string;
};

/** CEO mailbox (akshay@) — separate from invoice SMTP_* config. */
export function getCeoMailConfig(): CeoMailConfig | null {
  const user = process.env.CEO_MAIL_USER?.trim();
  const pass = process.env.CEO_MAIL_PASS?.trim();
  if (!user || !pass) return null;

  const host =
    process.env.CEO_MAIL_HOST?.trim() ||
    process.env.IMAP_HOST?.trim() ||
    process.env.SMTP_HOST?.trim() ||
    "mail.thebluridge.com";
  const smtpPort = Number(process.env.CEO_MAIL_SMTP_PORT || "587");
  const imapPort = Number(process.env.CEO_MAIL_IMAP_PORT || "993");
  const smtpSecure =
    process.env.CEO_MAIL_SMTP_SECURE === "true" || smtpPort === 465;
  const imapSecure =
    process.env.CEO_MAIL_IMAP_SECURE !== "false" && imapPort === 993;
  const sievePort = Number(process.env.CEO_MAIL_SIEVE_PORT || "4190");
  const from =
    process.env.CEO_MAIL_FROM?.trim() || `"Akshay" <${user}>`;

  return {
    host,
    smtpPort,
    smtpSecure,
    imapPort,
    imapSecure,
    sievePort,
    user,
    pass,
    from,
  };
}

export function ceoMailConfigured(): boolean {
  return getCeoMailConfig() != null;
}

/**
 * Resolves any mailbox's connection config, not just akshay@ — every
 * existing call site (sync.ts, imap-mailbox.ts, outbox.ts, managesieve.ts,
 * drafts.ts, idle-watcher.ts, labels.ts, the attachments route) swaps its
 * `getCeoMailConfig()` call for this, passing whatever account it already
 * has in scope. `credentialKey === "ceo_env"` (akshay@, always) keeps
 * reading CEO_MAIL_* env vars via the exact function above, completely
 * unchanged; any other mailbox loads + decrypts its MailAccountCredential
 * row. Same CeoMailConfig shape either way.
 */
export async function getMailConfig(account: {
  id: string;
  credentialKey: string;
  address: string;
  displayName?: string | null;
}): Promise<CeoMailConfig | null> {
  if (account.credentialKey === "ceo_env") return getCeoMailConfig();

  const cred = await prisma.mailAccountCredential.findUnique({
    where: { accountId: account.id },
  });
  if (!cred) return null;

  return {
    host: cred.host,
    smtpPort: cred.smtpPort,
    smtpSecure: cred.smtpSecure,
    imapPort: cred.imapPort,
    imapSecure: cred.imapSecure,
    sievePort: cred.sievePort,
    user: cred.username,
    pass: decryptSecret(cred.passwordEncrypted),
    from: account.displayName
      ? `"${account.displayName}" <${account.address}>`
      : account.address,
  };
}
