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
