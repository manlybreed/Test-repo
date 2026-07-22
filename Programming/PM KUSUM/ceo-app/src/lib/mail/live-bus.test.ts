import { describe, expect, it, vi } from "vitest";
import { getMailLiveBus, publishMailLive } from "@/lib/mail/live-bus";

describe("mail live bus", () => {
  it("publishes events to subscribers", () => {
    const bus = getMailLiveBus();
    const spy = vi.fn();
    bus.on("mail", spy);
    publishMailLive({ type: "mail:updated", imported: 2, accountId: "a1" });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toMatchObject({
      type: "mail:updated",
      imported: 2,
      accountId: "a1",
    });
    bus.off("mail", spy);
  });
});
