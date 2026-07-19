import { describe, expect, it } from "vitest";
import { assertAutonomy } from "@/lib/mail/ai/policy";

describe("AI-19 schedule-send policy", () => {
  it("schedule_send is irreversible without confirm", () => {
    expect(() => assertAutonomy("schedule_send")).toThrow();
    expect(() =>
      assertAutonomy("schedule_send", { confirmed: true }),
    ).not.toThrow();
  });
});
