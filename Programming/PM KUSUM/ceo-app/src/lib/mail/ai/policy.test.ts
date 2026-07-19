import { describe, expect, it } from "vitest";
import {
  assertAutonomy,
  checkAutonomy,
  isIrreversible,
} from "@/lib/mail/ai/policy";

describe("AI-21 autonomy policy", () => {
  it("marks irreversible actions", () => {
    expect(isIrreversible("send")).toBe(true);
    expect(isIrreversible("create_task")).toBe(true);
    expect(isIrreversible("label")).toBe(false);
  });

  it("blocks irreversible without confirm", () => {
    expect(checkAutonomy("send").allowed).toBe(false);
    expect(checkAutonomy("send", { confirmed: true }).allowed).toBe(true);
  });

  it("allows reversible label/priority by default", () => {
    expect(checkAutonomy("label").allowed).toBe(true);
    expect(checkAutonomy("priority", { autoPriority: false }).allowed).toBe(
      false,
    );
  });

  it("assertAutonomy throws", () => {
    expect(() => assertAutonomy("delete")).toThrow(/confirmation/);
  });
});
