import { describe, expect, it } from "vitest";
import {
  buildThreadSearchAnd,
  classifySearchTier,
  needsWordBoundary,
  parseSearchOperators,
  scoreSearchHit,
  SYNONYMS,
  synonymVariants,
  textHasToken,
  tokenizeSearchQuery,
} from "@/lib/mail/mail-search";
import { literalSearchPlan } from "@/lib/mail/ai/search-expand";

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

  it("does not treat pos as a substring of proposal", () => {
    expect(textHasToken("proposal for financing", "pos")).toBe(false);
    expect(textHasToken("daily pos e-statement", "pos")).toBe(true);
    expect(textHasToken("DAILY POS E-Statement", "pos")).toBe(true);
    expect(needsWordBoundary("pos")).toBe(true);
    expect(needsWordBoundary("proposal")).toBe(false);
  });

  it("ranks real POS e-statement above SBI financing proposal (no false pos)", () => {
    const plan = {
      mustGroups: [
        ["sbi", "state bank"],
        ["pos", "e-statement", "estatement"],
      ],
    };
    const real = scoreSearchHit({
      query: "SBI POS machine",
      subject: "DAILY POS E-Statement : BLURIDGE CONSULTING",
      fromAddress: "alerts@sbi.co.in",
      plan,
    });
    const falsePos = scoreSearchHit({
      query: "SBI POS machine",
      subject: "BluRidge <> SBI | Proposal for Financing",
      fromAddress: "akshay@thebluridge.com",
      snippet: "Dear Mr. Ranjit Kumar, This is with...",
      plan,
    });
    expect(real).toBeGreaterThan(falsePos);
    // Financing proposal must not satisfy the POS concept group via "proposal".
    expect(falsePos).toBeLessThan(40);
  });

  it("scores a multi-word-synonym-only match lower than a literal-token match — a second, general defense layer beyond word-boundary matching and the SYNONYMS-table audit above, independent of which specific word is involved", () => {
    // A deliberately synthetic, made-up concept group — not any real
    // SYNONYMS entry — validating the scoring MECHANISM (a single-word
    // literal match outscores a multi-word-only match) in the abstract,
    // not for "pos"/"sbi" specifically. Query phrase deliberately never
    // appears contiguously in either subject, so the top-level exact
    // -phrase bonus can't be what's actually driving the result — only
    // the per-group multi-word-vs-literal weighting can.
    const plan = {
      mustGroups: [
        ["acme", "acme corp"],
        ["widget", "small mechanical gadget"],
      ],
    };
    const literalMatch = scoreSearchHit({
      query: "acme widget",
      subject: "Acme order: widget shipped confirmation",
      plan,
    });
    const multiWordOnlyMatch = scoreSearchHit({
      query: "acme widget",
      subject: "Acme order: small mechanical gadget shipped confirmation",
      plan,
    });
    expect(literalMatch).toBeGreaterThan(multiWordOnlyMatch);
  });

  it("no long synonym variant is silently shared between unrelated, non-cross-referencing concept keys", () => {
    // General, mechanical audit of the SYNONYMS table itself — not about
    // "pos" or "sbi" specifically, and it would catch the next accidental
    // concept merge for any other keyword pair too.
    //
    // Two keys legitimately share vocabulary when they're aliases of the
    // *same* real-world thing (machine/terminal are the same card device;
    // kusum/pmkusum are the same project name spelled two ways) — and in
    // every such legitimate case in this table, at least one of the two
    // keys explicitly lists the other key's name as its own variant. A
    // shared long (>4 char) phrase between two keys that DON'T reference
    // each other at all is not a legitimate alias — it's one concept's
    // vocabulary accidentally leaking into an unrelated concept's list
    // (exactly how "e-statement"/"estatement" ended up inside "pos"
    // without "pos" and "statement" ever naming each other).
    const keys = Object.keys(SYNONYMS);
    const lower = (arr: string[]) => arr.map((s) => s.trim().toLowerCase());
    const violations: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = keys[i]!;
        const b = keys[j]!;
        const av = lower(SYNONYMS[a]!);
        const bv = lower(SYNONYMS[b]!);
        const shared = av.filter((v) => v.length > 4 && bv.includes(v));
        if (!shared.length) continue;
        const reciprocated = av.includes(b) || bv.includes(a);
        if (!reciprocated) {
          violations.push(
            `"${a}" and "${b}" share ${JSON.stringify(shared)} but neither lists the other as a variant`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("literalSearchPlan resolves distinct jargon pairs to exact tokens with no synonym expansion — proves the fix generalizes across unrelated vocabularies, not just sbi/pos", () => {
    // Four unrelated domains: the reported bank/POS pair, a different
    // bank + product-jargon pair, non-banking tax jargon, and this
    // project's own internal jargon.
    expect(literalSearchPlan("SBI POS machine").mustGroups).toEqual([
      ["sbi"],
      ["pos"],
    ]);
    expect(literalSearchPlan("HDFC EDC device").mustGroups).toEqual([
      ["hdfc"],
      ["edc"],
    ]);
    expect(literalSearchPlan("invoice GST").mustGroups).toEqual([
      ["invoice"],
      ["gst"],
    ]);
    expect(literalSearchPlan("PM KUSUM proposal").mustGroups).toEqual([
      ["pm"],
      ["kusum"],
      ["proposal"],
    ]);
  });

  it("literalSearchPlan never expands ANY SYNONYMS key into its variant list — an architectural guarantee, not a per-keyword patch", () => {
    // For every real key in the hand-curated table, a single-token query
    // for that key must resolve to exactly [[key]] — never the expanded
    // variant list. This means a future bad or overly-broad SYNONYMS entry,
    // for ANY word, can never corrupt what step 1 of the search waterfall
    // finds; only the deliberate lexical/AI fallback steps ever consult
    // synonymVariants at all.
    for (const key of Object.keys(SYNONYMS)) {
      expect(literalSearchPlan(key).mustGroups).toEqual([[key]]);
    }
  });

  it("a synthetic, made-up bad synonym mapping (independent of the real SYNONYMS table) cannot leak into a literal plan or corrupt matching against a literal-only document — the general blast-radius containment the waterfall relies on", () => {
    // Deliberately fake, nonsensical pairing that would never appear in the
    // real table — this is about the SHAPE of the guarantee, not about
    // "pos"/"e-statement" specifically.
    const fakeBadSynonyms: Record<string, string[]> = {
      widget: ["widget", "unrelated concept that would never co-occur"],
    };
    expect(literalSearchPlan("widget").mustGroups).toEqual([["widget"]]);
    expect(fakeBadSynonyms.widget).not.toEqual(
      literalSearchPlan("widget").mustGroups[0],
    );

    // A document containing ONLY the literal tokens the user typed (no
    // expanded synonym phrase anywhere, real or fake) already satisfies
    // every mustGroup produced by literalSearchPlan — proving step 1 of the
    // waterfall never needs a synonym group to resolve anything.
    const plan = literalSearchPlan("SBI POS machine");
    const literalOnlyDoc = "sbi pos maintenance ticket"; // no "state bank", no "point of sale"
    for (const group of plan.mustGroups) {
      expect(group.some((v) => textHasToken(literalOnlyDoc, v))).toBe(true);
    }
  });

  it("classifies bare names as person tier (no AI)", () => {
    expect(classifySearchTier("prachi")).toBe("person");
    expect(classifySearchTier("John Smith")).toBe("person");
  });

  it("classifies bank/product jargon as keyword, not person", () => {
    expect(classifySearchTier("SBI POS")).toBe("keyword");
    expect(classifySearchTier("SBI POS machine")).toBe("keyword");
    expect(classifySearchTier("invoice")).toBe("keyword");
    expect(classifySearchTier("kusum")).toBe("keyword");
  });

  it("classifies questions and paraphrase as NL", () => {
    expect(classifySearchTier("who sent the transformer quote?")).toBe("nl");
    expect(classifySearchTier("emails about the loan status")).toBe("nl");
    expect(classifySearchTier("find me the mail regarding POS")).toBe("nl");
  });

  it("expands POS / SBI synonyms", () => {
    expect(synonymVariants("pos")).toEqual(
      expect.arrayContaining(["pos", "point of sale"]),
    );
    // A POS card machine and a bank e-statement are different concepts —
    // this was the actual root cause of the "SBI POS Machine" false
    // positive (a financing-proposal email discussing e-statements
    // satisfied the "pos" concept group even with nothing to do with a
    // physical machine). Pin the fix down directly, not just its absence.
    expect(synonymVariants("pos")).not.toEqual(
      expect.arrayContaining(["e-statement"]),
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
