import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getMailConfig, type MailConfig } from "@/lib/mail/config";

export function createSmtpTransport(config?: MailConfig): Transporter {
  const cfg = config ?? getMailConfig();
  if (!cfg) {
    throw new Error(
      "Mail not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS (and optionally SMTP_PORT=587).",
    );
  }
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

export async function verifySmtp(config?: MailConfig): Promise<boolean> {
  const transport = createSmtpTransport(config);
  await transport.verify();
  return true;
}
