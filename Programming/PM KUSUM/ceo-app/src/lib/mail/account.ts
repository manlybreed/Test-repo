import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";

/** Every newly created mailbox gets the same starting defaults, regardless
 * of whether it's the env-configured one or one added via the settings UI. */
async function createAccountDefaults(
  accountId: string,
  opts: { signatureName?: string },
) {
  await prisma.mailAutonomySettings.create({
    data: { accountId },
  });

  await prisma.mailSignature.create({
    data: {
      accountId,
      name: "Default",
      isDefault: true,
      htmlBody: `<p>Best regards,<br/>${opts.signatureName || ""}</p>`,
    },
  });
}

/** Ensure MailAccount row for CEO env mailbox (akshay@). */
export async function ensureCeoMailAccount(userId?: string | null) {
  const cfg = getCeoMailConfig();
  if (!cfg) return null;

  const existing = await prisma.mailAccount.findUnique({
    where: { address: cfg.user.toLowerCase() },
  });
  if (existing) {
    if (userId && !existing.userId) {
      return prisma.mailAccount.update({
        where: { id: existing.id },
        data: { userId },
      });
    }
    return existing;
  }

  const account = await prisma.mailAccount.create({
    data: {
      address: cfg.user.toLowerCase(),
      displayName: cfg.from,
      credentialKey: "ceo_env",
      userId: userId || null,
    },
  });

  await createAccountDefaults(account.id, { signatureName: "Akshay<br/>BluRidge Consulting" });

  return account;
}

/**
 * Creates a MailAccount row (+ default autonomy settings + signature) for a
 * mailbox added via the in-app settings UI — the credential row itself is
 * created separately by addMailAccountAction, right after this, since it
 * needs the new account's id. Mirrors ensureCeoMailAccount's bootstrap
 * exactly, just for a non-"ceo_env" mailbox.
 */
export async function createMailAccountShell(opts: {
  address: string;
  displayName?: string | null;
  userId: string;
}) {
  const account = await prisma.mailAccount.create({
    data: {
      address: opts.address.toLowerCase(),
      displayName: opts.displayName || null,
      credentialKey: "db",
      userId: opts.userId,
    },
  });
  await createAccountDefaults(account.id, { signatureName: opts.displayName || opts.address });
  return account;
}

/** Fetches a mailbox and verifies the session user actually owns it. */
export async function requireOwnedAccount(accountId: string, userId: string) {
  const account = await prisma.mailAccount.findFirst({
    where: { id: accountId, userId },
  });
  if (!account) throw new Error("Mailbox not found");
  return account;
}

/**
 * Resolves the correct mailbox for a thread-scoped action by looking at the
 * thread itself — MailThread.id is globally unique across every mailbox the
 * user has, so this is enough to know which account a reply/archive/trash/
 * label-correction/etc. actually belongs to, with no explicit accountId
 * parameter needed on the action itself. Still verifies ownership, so one
 * user can never touch another user's mailbox via a guessed thread id.
 */
export async function requireOwnedAccountForThread(threadId: string, userId: string) {
  const thread = await prisma.mailThread.findUnique({
    where: { id: threadId },
    include: { account: true },
  });
  if (!thread || thread.account.userId !== userId) {
    throw new Error("Thread not found");
  }
  return { account: thread.account, thread };
}
