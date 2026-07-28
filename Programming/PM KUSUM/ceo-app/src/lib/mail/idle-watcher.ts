import { ImapFlow } from "imapflow";
import { prisma } from "@/lib/prisma";
import { getMailConfig } from "@/lib/mail/ceo-config";
import { ensureCeoMailAccount } from "@/lib/mail/account";
import { syncCeoMail } from "@/lib/mail/sync";
import { publishMailLive } from "@/lib/mail/live-bus";

type AccountRef = {
  id: string;
  credentialKey: string;
  address: string;
  displayName?: string | null;
};

type PerAccountState = {
  started: boolean;
  stopping: boolean;
  clients: ImapFlow[];
};

// One IDLE watcher per configured mailbox, not one global pair — keyed by
// accountId so adding a mailbox can start its own loop independently of
// whatever the others are doing, and so one mailbox's connection trouble
// never affects another's.
type IdleGlobal = typeof globalThis & {
  __ceoMailIdle?: Map<string, PerAccountState>;
};

function idleStates(): Map<string, PerAccountState> {
  const g = globalThis as IdleGlobal;
  if (!g.__ceoMailIdle) g.__ceoMailIdle = new Map();
  return g.__ceoMailIdle;
}

function stateFor(accountId: string): PerAccountState {
  const states = idleStates();
  let s = states.get(accountId);
  if (!s) {
    s = { started: false, stopping: false, clients: [] };
    states.set(accountId, s);
  }
  return s;
}

async function connectIdleClient(account: AccountRef) {
  const cfg = await getMailConfig(account);
  if (!cfg) throw new Error(`Mail account not configured: ${account.address}`);
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.imapPort,
    secure: cfg.imapSecure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Stay in IDLE longer; imapflow renews as needed
    maxIdleTime: 25 * 60 * 1000,
  });
  await client.connect();
  return client;
}

async function resolveFolderPath(
  accountId: string,
  role: "INBOX" | "SENT",
  client: ImapFlow,
): Promise<string | null> {
  const row = await prisma.mailFolder.findFirst({
    where: { accountId, role },
    select: { path: true },
  });
  if (row?.path) return row.path;

  const list = await client.list();
  for (const box of list) {
    const special = (box.specialUse || "").toLowerCase();
    const base = (box.path.split(/[/.]/).pop() || box.path).toLowerCase();
    if (role === "INBOX" && (special.includes("inbox") || base === "inbox")) {
      return box.path;
    }
    if (
      role === "SENT" &&
      (special.includes("sent") || base === "sent" || base.includes("sent"))
    ) {
      return box.path;
    }
  }
  return role === "INBOX" ? "INBOX" : null;
}

function debounce(fn: () => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn();
    }, ms);
  };
}

async function pullDelta(accountId: string, role: "INBOX" | "SENT") {
  try {
    const result = await syncCeoMail({
      accountId,
      incremental: true,
      roles: [role],
      maxPerFolder: 80,
      maxTriageNew: role === "INBOX" ? 4 : 0,
    });
    publishMailLive({
      type: "mail:updated",
      accountId: result.accountId,
      imported: result.imported,
      folderRole: role,
    });
  } catch (e) {
    publishMailLive({
      type: "mail:error",
      accountId,
      message: e instanceof Error ? e.message : "Idle sync failed",
      folderRole: role,
    });
  }
}

async function applyFlagUpdate(
  accountId: string,
  folderPath: string,
  uid: number,
  flags: Set<string>,
) {
  const folder = await prisma.mailFolder.findFirst({
    where: { accountId, path: folderPath },
    select: { id: true },
  });
  if (!folder) return;
  const msg = await prisma.mailMessage.findUnique({
    where: { folderId_imapUid: { folderId: folder.id, imapUid: uid } },
    select: { id: true, threadId: true },
  });
  if (!msg) return;
  await prisma.mailMessage.update({
    where: { id: msg.id },
    data: {
      seen: flags.has("\\Seen"),
      flagged: flags.has("\\Flagged"),
      answered: flags.has("\\Answered"),
    },
  });
  const { recomputeThreadDenorm } = await import("@/lib/mail/threads-query");
  await recomputeThreadDenorm(msg.threadId).catch(() => undefined);
  publishMailLive({
    type: "mail:updated",
    accountId,
    imported: 0,
    folderRole: "FLAGS",
  });
}

async function applyExpunge(
  accountId: string,
  folderPath: string,
  uid: number | undefined,
) {
  if (!uid) {
    // Seq-only expunge — catch up via delta pull
    await pullDelta(
      accountId,
      folderPath.toLowerCase().includes("sent") ? "SENT" : "INBOX",
    );
    return;
  }
  const folder = await prisma.mailFolder.findFirst({
    where: { accountId, path: folderPath },
    select: { id: true },
  });
  if (!folder) return;
  const msg = await prisma.mailMessage.findUnique({
    where: { folderId_imapUid: { folderId: folder.id, imapUid: uid } },
    select: { id: true, threadId: true },
  });
  if (!msg) return;
  await prisma.mailMessage.delete({ where: { id: msg.id } });
  const { recomputeThreadDenorm } = await import("@/lib/mail/threads-query");
  await recomputeThreadDenorm(msg.threadId).catch(() => undefined);
  publishMailLive({
    type: "mail:updated",
    accountId,
    imported: 0,
    folderRole: "EXPUNGE",
  });
}

async function watchRole(account: AccountRef, role: "INBOX" | "SENT"): Promise<void> {
  const state = stateFor(account.id);

  const client = await connectIdleClient(account);
  state.clients.push(client);

  const pathName = await resolveFolderPath(account.id, role, client);
  if (!pathName) {
    await client.logout().catch(() => undefined);
    return;
  }

  await client.mailboxOpen(pathName);

  const onExists = debounce(() => {
    void pullDelta(account.id, role);
  }, 500);

  client.on("exists", (data: { count: number; prevCount: number }) => {
    if (data.count > data.prevCount) onExists();
  });

  client.on(
    "flags",
    (data: { path: string; uid?: number; flags: Set<string> }) => {
      if (!data.uid) return;
      void applyFlagUpdate(account.id, data.path || pathName, data.uid, data.flags);
    },
  );

  client.on(
    "expunge",
    (data: { path: string; uid?: number; vanished?: boolean }) => {
      void applyExpunge(account.id, data.path || pathName, data.uid);
    },
  );

  publishMailLive({
    type: "mail:idle",
    accountId: account.id,
    folderRole: role,
    message: `Watching ${pathName} (${account.address})`,
  });

  // Keep the promise pending until close/error — caller reconnects
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    client.once("close", done);
    client.once("error", done);
  });
}

async function runWatcherLoop(account: AccountRef) {
  const state = stateFor(account.id);
  let backoffMs = 2000;

  while (!state.stopping) {
    try {
      // Seed folder rows so path resolution works
      await syncCeoMail({
        accountId: account.id,
        incremental: true,
        roles: ["INBOX", "SENT"],
        maxPerFolder: 40,
        maxTriageNew: 0,
      }).catch(() => undefined);

      backoffMs = 2000;
      await Promise.all([
        watchRole(account, "INBOX").catch((e) => {
          publishMailLive({
            type: "mail:error",
            accountId: account.id,
            message: e instanceof Error ? e.message : "INBOX idle failed",
            folderRole: "INBOX",
          });
        }),
        watchRole(account, "SENT").catch((e) => {
          publishMailLive({
            type: "mail:error",
            accountId: account.id,
            message: e instanceof Error ? e.message : "SENT idle failed",
            folderRole: "SENT",
          });
        }),
      ]);
    } catch (e) {
      publishMailLive({
        type: "mail:error",
        accountId: account.id,
        message: e instanceof Error ? e.message : "Idle watcher failed",
      });
    }

    // Drop dead clients before reconnect
    state.clients = [];
    if (state.stopping) break;
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, 60_000);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start (or no-op if already running) the IDLE loop for one specific
 * mailbox. Safe to call any time — used both at process startup (for
 * every mailbox already configured) and right after adding a new one, so
 * a freshly added mailbox goes live immediately without an app restart.
 */
export function ensureIdleClientFor(account: AccountRef): void {
  if (process.env.CEO_MAIL_IDLE === "0") return;
  const state = stateFor(account.id);
  if (state.started) return;
  state.started = true;
  state.stopping = false;
  void runWatcherLoop(account);
}

/** Start IMAP IDLE watchers for every configured mailbox, once per process (Next instrumentation). */
export async function startMailIdleWatcher(): Promise<void> {
  if (process.env.CEO_MAIL_IDLE === "0") return;

  // Lazily creates the ceo_env row on a cold boot (mirrors the original
  // single-account behavior) — otherwise the primary mailbox's watcher
  // wouldn't start until someone actually loads the mail page first.
  await ensureCeoMailAccount(null).catch(() => null);

  const accounts = await prisma.mailAccount.findMany({
    select: { id: true, credentialKey: true, address: true, displayName: true },
  });
  for (const account of accounts) {
    ensureIdleClientFor(account);
  }
}

export function stopMailIdleWatcher(): void {
  for (const state of idleStates().values()) {
    state.stopping = true;
    for (const c of state.clients) {
      void c.logout().catch(() => undefined);
    }
    state.clients = [];
    state.started = false;
  }
}
