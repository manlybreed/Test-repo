import { prisma } from "@/lib/prisma";
import { getCeoMailConfig } from "@/lib/mail/ceo-config";

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

  await prisma.mailAutonomySettings.create({
    data: { accountId: account.id },
  });

  await prisma.mailSignature.create({
    data: {
      accountId: account.id,
      name: "Default",
      isDefault: true,
      htmlBody: `<p>Best regards,<br/>Akshay<br/>BluRidge Consulting</p>`,
    },
  });

  return account;
}
