import { EventEmitter } from "events";

export type MailLiveEvent = {
  type: "mail:updated" | "mail:idle" | "mail:error";
  accountId?: string;
  imported?: number;
  folderRole?: string;
  at: string;
  message?: string;
};

type Bus = EventEmitter & {
  publish: (event: MailLiveEvent) => void;
};

const g = globalThis as typeof globalThis & { __ceoMailLiveBus?: Bus };

function createBus(): Bus {
  const ee = new EventEmitter() as Bus;
  ee.setMaxListeners(50);
  ee.publish = (event: MailLiveEvent) => {
    ee.emit("mail", event);
  };
  return ee;
}

/** Process-local pub/sub for IDLE → SSE (same Node process as Next). */
export function getMailLiveBus(): Bus {
  if (!g.__ceoMailLiveBus) g.__ceoMailLiveBus = createBus();
  return g.__ceoMailLiveBus;
}

export function publishMailLive(event: Omit<MailLiveEvent, "at"> & { at?: string }) {
  getMailLiveBus().publish({
    ...event,
    at: event.at || new Date().toISOString(),
  });
}
