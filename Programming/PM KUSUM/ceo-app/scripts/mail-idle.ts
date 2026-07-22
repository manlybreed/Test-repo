/**
 * Optional standalone IMAP IDLE worker (same process bus only helps when
 * co-located with Next). Prefer instrumentation.ts — this script is for
 * debugging / future multi-process setups.
 *
 *   npx tsx scripts/mail-idle.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

async function main() {
  const { startMailIdleWatcher } = await import("../src/lib/mail/idle-watcher");
  startMailIdleWatcher();
  // Keep process alive
  // eslint-disable-next-line no-console
  console.log("[mail-idle] watching INBOX + SENT (Ctrl+C to stop)");
  await new Promise(() => undefined);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
