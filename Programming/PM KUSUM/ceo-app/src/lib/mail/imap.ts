import { ImapFlow } from "imapflow";
import type { MailConfig } from "@/lib/mail/config";

export type FoundMessage = {
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: Date | null;
};

/** Search recent INBOX messages by subject substring (IMAP receive check). */
export async function findRecentBySubject(
  config: Pick<MailConfig, "imapHost" | "imapPort" | "imapSecure" | "user" | "pass">,
  subjectIncludes: string,
  opts?: { mailbox?: string; limit?: number; sinceMinutes?: number },
): Promise<FoundMessage[]> {
  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  const found: FoundMessage[] = [];
  await client.connect();
  try {
    const mailbox = opts?.mailbox || "INBOX";
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date(
        Date.now() - (opts?.sinceMinutes ?? 30) * 60 * 1000,
      );
      const uids = await client.search(
        { since, subject: subjectIncludes },
        { uid: true },
      );
      const list = uids === false ? [] : uids;
      if (!list.length) return found;
      const take = list.slice(-(opts?.limit ?? 10));
      for await (const msg of client.fetch(take, {
        uid: true,
        envelope: true,
      })) {
        const subj = msg.envelope?.subject || "";
        if (!subj.toLowerCase().includes(subjectIncludes.toLowerCase())) continue;
        found.push({
          uid: msg.uid,
          subject: subj,
          from: msg.envelope?.from?.[0]?.address || "",
          to: msg.envelope?.to?.[0]?.address || "",
          date: msg.envelope?.date ?? null,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return found;
}
