import { randomUUID } from "crypto";
import { htmlToText } from "@/lib/mail/normalize";

function encodeUtf8Header(value: string) {
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Build a simple multipart/alternative MIME buffer for IMAP APPEND. */
export function buildRawMime(input: {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string | null;
  referencesHdr?: string | null;
  messageId?: string | null;
}) {
  const boundary = `br_${randomUUID().replace(/-/g, "")}`;
  const text = htmlToText(input.bodyHtml);
  const cc = input.cc || [];
  const bcc = input.bcc || [];
  const headers = [
    `From: ${input.from}`,
    input.to.length
      ? `To: ${input.to.join(", ")}`
      : "To: undisclosed-recipients:;",
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    bcc.length ? `Bcc: ${bcc.join(", ")}` : null,
    `Subject: ${encodeUtf8Header(input.subject || "(no subject)")}`,
    `Date: ${new Date().toUTCString()}`,
    input.messageId ? `Message-ID: ${input.messageId}` : null,
    "MIME-Version: 1.0",
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : null,
    input.referencesHdr ? `References: ${input.referencesHdr}` : null,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
    .filter(Boolean)
    .join("\r\n");

  const body = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyHtml,
    `--${boundary}--`,
    "",
  ].join("\r\n");

  return Buffer.from(`${headers}\r\n\r\n${body}`, "utf8");
}
