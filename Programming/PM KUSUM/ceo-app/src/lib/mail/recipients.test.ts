import { describe, expect, it } from "vitest";
import {
  avatarHue,
  parseRecipients,
  recipientInitials,
  serializeRecipients,
} from "./recipients";

describe("parseRecipients", () => {
  it("parses a bare address", () => {
    expect(parseRecipients("jane@x.com")).toEqual([
      { address: "jane@x.com", displayName: null },
    ]);
  });

  it("parses Name <email> without quotes", () => {
    expect(parseRecipients("Jane Doe <jane@x.com>")).toEqual([
      { address: "jane@x.com", displayName: "Jane Doe" },
    ]);
  });

  it("parses \"Name\" <email> with quotes", () => {
    expect(parseRecipients('"Jane Doe" <jane@x.com>')).toEqual([
      { address: "jane@x.com", displayName: "Jane Doe" },
    ]);
  });

  it("splits multiple comma-separated tokens", () => {
    expect(parseRecipients("a@x.com, Bob <b@x.com>")).toEqual([
      { address: "a@x.com", displayName: null },
      { address: "b@x.com", displayName: "Bob" },
    ]);
  });

  it("splits multiple semicolon-separated tokens", () => {
    expect(parseRecipients("a@x.com; b@x.com")).toEqual([
      { address: "a@x.com", displayName: null },
      { address: "b@x.com", displayName: null },
    ]);
  });

  it("returns an empty array for empty/whitespace input", () => {
    expect(parseRecipients("")).toEqual([]);
    expect(parseRecipients("   ")).toEqual([]);
    expect(parseRecipients(" , ; ")).toEqual([]);
  });

  it("ignores stray empty tokens from trailing separators", () => {
    expect(parseRecipients("a@x.com, ")).toEqual([
      { address: "a@x.com", displayName: null },
    ]);
  });
});

describe("serializeRecipients", () => {
  it("round-trips through parseRecipients", () => {
    const raw = "a@x.com, Bob Jones <b@x.com>";
    const list = parseRecipients(raw);
    expect(serializeRecipients(list)).toBe("a@x.com, Bob Jones <b@x.com>");
    expect(parseRecipients(serializeRecipients(list))).toEqual(list);
  });

  it("renders a bare address with no displayName", () => {
    expect(serializeRecipients([{ address: "a@x.com", displayName: null }])).toBe(
      "a@x.com",
    );
  });

  it("returns an empty string for an empty list", () => {
    expect(serializeRecipients([])).toBe("");
  });
});

describe("avatarHue", () => {
  it("is deterministic for the same seed", () => {
    expect(avatarHue("jane@x.com")).toBe(avatarHue("jane@x.com"));
  });

  it("stays within [0, 360)", () => {
    const hue = avatarHue("someone.long@example.com");
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });
});

describe("recipientInitials", () => {
  it("uses first+last initials from a two-word displayName", () => {
    expect(recipientInitials({ address: "j@x.com", displayName: "Jane Doe" })).toBe(
      "JD",
    );
  });

  it("falls back to the first two chars of a single-word displayName", () => {
    expect(recipientInitials({ address: "j@x.com", displayName: "Jane" })).toBe("JA");
  });

  it("falls back to the local part of the address when there's no displayName", () => {
    expect(recipientInitials({ address: "jane@x.com", displayName: null })).toBe("JA");
  });
});
