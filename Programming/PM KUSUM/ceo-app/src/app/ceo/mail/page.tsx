import { getMailBootstrap } from "@/actions/mail";
import { MailClient } from "@/components/mail/mail-client";

export default async function MailPage() {
  const data = await getMailBootstrap();

  if (!data.configured) {
    return (
      <MailClient
        configured={false}
        folders={[]}
        threads={[]}
        signatures={[]}
        reminders={[]}
      />
    );
  }

  return (
    <MailClient
      configured
      account={data.account}
      folders={data.folders}
      threads={data.threads}
      signatures={data.signatures}
      reminders={data.reminders}
    />
  );
}
