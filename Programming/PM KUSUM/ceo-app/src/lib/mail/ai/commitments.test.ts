import { describe, expect, it } from "vitest";
import { assertAutonomy } from "@/lib/mail/ai/policy";

describe("AI-10 commitment confirm gate", () => {
  it("create_task requires confirm", () => {
    expect(() => assertAutonomy("create_task")).toThrow();
    expect(() =>
      assertAutonomy("create_task", { confirmed: true }),
    ).not.toThrow();
  });
});
