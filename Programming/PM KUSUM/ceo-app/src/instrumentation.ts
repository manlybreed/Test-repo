export async function register() {
  // IMAP IDLE must not run in the Edge runtime.
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { ceoMailConfigured } = await import("@/lib/mail/ceo-config");
  if (!ceoMailConfigured()) return;
  if (process.env.CEO_MAIL_IDLE === "0") return;

  const { startMailIdleWatcher } = await import("@/lib/mail/idle-watcher");
  startMailIdleWatcher();
}
