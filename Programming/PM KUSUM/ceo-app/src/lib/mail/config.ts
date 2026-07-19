export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Always CC'd on invoice emails */
  accountsCc: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
};

export const DEFAULT_ACCOUNTS_CC = "accounts@thebluridge.com";

export function getMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;

  const port = Number(process.env.SMTP_PORT || "587");
  const secure =
    process.env.SMTP_SECURE === "true" || port === 465;
  const from =
    process.env.MAIL_FROM?.trim() ||
    `"BluRidge Consulting" <${user}>`;
  const accountsCc =
    process.env.MAIL_ACCOUNTS_CC?.trim() || DEFAULT_ACCOUNTS_CC;
  const imapHost = process.env.IMAP_HOST?.trim() || host;
  const imapPort = Number(process.env.IMAP_PORT || "993");
  const imapSecure =
    process.env.IMAP_SECURE !== "false" && imapPort === 993;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    accountsCc,
    imapHost,
    imapPort,
    imapSecure,
  };
}

export function mailConfigured(): boolean {
  return getMailConfig() != null;
}
