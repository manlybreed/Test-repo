export type CeoMailConfig = {
  host: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapPort: number;
  imapSecure: boolean;
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
  const from =
    process.env.CEO_MAIL_FROM?.trim() || `"Akshay" <${user}>`;

  return {
    host,
    smtpPort,
    smtpSecure,
    imapPort,
    imapSecure,
    user,
    pass,
    from,
  };
}

export function ceoMailConfigured(): boolean {
  return getCeoMailConfig() != null;
}
