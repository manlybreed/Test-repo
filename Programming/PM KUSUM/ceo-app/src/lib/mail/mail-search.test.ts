import { describe, expect, it } from "vitest";
import {
  buildThreadSearchAnd,
  parseSearchOperators,
  scoreSearchHit,
  synonymVariants,
  tokenizeSearchQuery,
} from "@/lib/mail/mail-search";

describe("mail search", () => {
  it("tokenizes multi-word queries and drops stop words", () => {
    expect(tokenizeSearchQuery("SBI POS machine")).toEqual([
      "sbi",
      "pos",
      "machine",
    ]);
    expect(tokenizeSearchQuery("mail regarding the SBI POS")).toEqual([
      "sbi",
      "pos",
    ]);
  });

  it("expands POS / SBI synonyms", () => {
    expect(synonymVariants("pos")).toEqual(
      expect.arrayContaining(["pos", "e-statement"]),
    );
    expect(synonymVariants("sbi")).toEqual(
      expect.arrayContaining(["sbi", "state bank"]),
    );
  });

  it("requires SBI+POS but treats machine as optional", () => {
    const and = buildThreadSearchAnd("SBI POS machine");
    // machine is optional — only sbi + pos are required
    expect(and).toHaveLength(2);
  });

  it("ranks subject hits with all tokens above weak body-only matches", () => {
    const strong = scoreSearchHit({
      query: "SBI POS machine",
      subject: "SBI POS machine installation",
      snippet: "Please arrange the terminal",
    });
    const weak = scoreSearchHit({
      query: "SBI POS machine",
      subject: "Hello",
      snippet: "sbi pos machine somewhere in body",
      searchBlob: "sbi pos machine somewhere in body",
    });
    expect(strong).toBeGreaterThan(weak);
  });

  it("matches e-statement style subjects via POS synonym scoring", () => {
    const score = scoreSearchHit({
      query: "SBI POS",
      subject: "DAILY POS E-Statement : BLURIDGE CONSULTING",
      fromAddress: "alerts@sbi.co.in",
    });
    expect(score).toBeGreaterThan(30);
  });

  it("applies a recency prior: fresh mail outranks an equal old match (R1)", () => {
    const base = {
      query: "SBI POS machine",
      subject: "SBI POS machine installation",
      snippet: "Please arrange the terminal",
    };
    const fresh = scoreSearchHit({ ...base, date: new Date() });
    const old = scoreSearchHit({
      ...base,
      date: new Date(Date.now() - 400 * 86_400_000),
    });
    expect(fresh).toBeGreaterThan(old);
    // Floored, not zeroed — a >1yr-old strong match keeps ≥40% of its score.
    expect(old).toBeGreaterThan(fresh * 0.39);
  });

  it("recency is opt-in: omitting date leaves the score undecayed (R1)", () => {
    const withoutDate = scoreSearchHit({
      query: "invoice",
      subject: "Tax invoice PF/2627",
    });
    const freshDated = scoreSearchHit({
      query: "invoice",
      subject: "Tax invoice PF/2627",
      date: new Date(),
    });
    // Same order of magnitude; no-date path must not decay.
    expect(withoutDate).toBeGreaterThanOrEqual(freshDated);
  });
});

describe("search operators", () => {
  it("strips a single operator and leaves no free text", () => {
    const { freeText, whereFragments } = parseSearchOperators("is:unread");
    expect(freeText).toBe("");
    expect(whereFragments).toEqual([{ unreadCount: { gt: 0 } }]);
  });

  it("mixes operators with free text, preserving the remainder", () => {
    const { freeText, whereFragments } = parseSearchOperators(
      "from:sbi loan status has:attachment",
    );
    expect(freeText).toBe("loan status");
    expect(whereFragments).toHaveLength(2);
  });

  it("parses from: to fromAddress/fromName OR clause", () => {
    const { whereFragments } = parseSearchOperators("from:sbi.co.in");
    expect(whereFragments[0]).toMatchObject({
      messages: {
        some: {
          OR: [
            { fromAddress: { contains: "sbi.co.in", mode: "insensitive" } },
            { fromName: { contains: "sbi.co.in", mode: "insensitive" } },
          ],
        },
      },
    });
  });

  it("supports quoted operator values", () => {
    const { freeText, whereFragments } = parseSearchOperators(
      'from:"State Bank" invoice',
    );
    expect(freeText).toBe("invoice");
    expect(whereFragments).toHaveLength(1);
  });

  it("parses before:/after: as date-range filters on lastMessageAt", () => {
    const { whereFragments } = parseSearchOperators(
      "after:2026-01-01 before:2026-06-01",
    );
    expect(whereFragments).toEqual([
      { lastMessageAt: { gte: new Date("2026-01-01") } },
      { lastMessageAt: { lt: new Date("2026-06-01") } },
    ]);
  });

  it("leaves unrecognized key:value pairs as literal free text", () => {
    const { freeText, whereFragments } = parseSearchOperators("priority:high");
    expect(freeText).toBe("priority:high");
    expect(whereFragments).toEqual([]);
  });

  it("is a no-op for plain free-text queries", () => {
    const { freeText, whereFragments } = parseSearchOperators("SBI POS machine");
    expect(freeText).toBe("SBI POS machine");
    expect(whereFragments).toEqual([]);
  });
});
