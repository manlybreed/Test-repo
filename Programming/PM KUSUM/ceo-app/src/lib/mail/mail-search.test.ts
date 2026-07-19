import { describe, expect, it } from "vitest";
import {
  buildThreadSearchAnd,
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
});
