import { describe, expect, it } from "vitest";
import { packChunks, type RetrievedChunk } from "@/lib/mail/ai/retrieve";

describe("AI-05 RAG pack", () => {
  it("packs chunks under budget and collects citations", () => {
    const chunks: RetrievedChunk[] = [
      {
        messageId: "m1",
        threadId: "t1",
        subject: "A",
        fromAddress: "a@b.com",
        date: "2026-01-01",
        snippet: "hi",
        bodyExcerpt: "hello",
      },
      {
        messageId: "m2",
        threadId: "t1",
        subject: "B",
        fromAddress: "c@d.com",
        date: "2026-01-02",
        snippet: "yo",
        bodyExcerpt: "world",
      },
    ];
    const { packed, citations } = packChunks(chunks, 5000);
    expect(citations).toEqual(["m1", "m2"]);
    expect(packed).toContain("[m1]");
  });

  it("empty chunks yield empty pack", () => {
    const { packed, citations } = packChunks([]);
    expect(packed).toBe("");
    expect(citations).toEqual([]);
  });
});
