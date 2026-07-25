import { describe, expect, it } from "vitest";
import { chunkText, stripQuotedTail } from "@/lib/mail/chunking";

describe("R3 chunking", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
    expect(chunkText("")).toEqual([]);
  });

  it("splits long text into overlapping chunks that cover the whole body", () => {
    const body = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(body, 500, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // First and last tokens are both represented somewhere.
    expect(chunks[0]).toContain("word0");
    expect(chunks.join(" ")).toContain("word399");
  });

  it("overlaps consecutive chunks so a boundary fact is not lost", () => {
    const body = Array.from({ length: 300 }, (_, i) => `t${i}`).join(" ");
    const chunks = chunkText(body, 400, 120);
    // Some token near a boundary appears in two consecutive chunks.
    const shared = chunks.slice(0, -1).some((c, i) => {
      const nxt = chunks[i + 1]!;
      return c
        .split(" ")
        .slice(-5)
        .some((tok) => nxt.includes(tok));
    });
    expect(shared).toBe(true);
  });

  it("strips an obvious quoted-reply tail but keeps the new content", () => {
    const text =
      "Thanks, that works for me. Let us proceed with the order.\n\n" +
      "On Mon, 1 Jul 2026 at 10:00, Ramesh <r@vendor.in> wrote:\n" +
      "> Please confirm the delivery date for the transformer.";
    const out = stripQuotedTail(text);
    expect(out).toContain("Let us proceed");
    expect(out).not.toContain("Please confirm the delivery date");
  });

  it("does not strip when there is no meaningful lead content", () => {
    const text = "On Mon, 1 Jul 2026, Ramesh wrote:\n> original";
    // Too little head content — leave it intact rather than emptying the chunk.
    expect(stripQuotedTail(text)).toBe(text);
  });
});
