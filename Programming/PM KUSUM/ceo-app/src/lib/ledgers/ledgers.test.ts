import { describe, expect, it } from "vitest";
import {
  isWithinRetention,
  periodYmFromDate,
  retentionUntilForDate,
} from "./retention";
import { isItcEligibleCategory } from "./inward";
import { parseInwardCsv } from "./portal-seed";

describe("retention heuristic", () => {
  it("extends past annual-return due + 72 months", () => {
    // FY 2025-26 → annual due 31 Dec 2026 → +72m ≈ Dec 2032
    const until = retentionUntilForDate(new Date("2025-06-15"), 72);
    expect(until.getFullYear()).toBe(2032);
    expect(until.getMonth()).toBe(11); // Dec
  });

  it("periodYm formats correctly", () => {
    expect(periodYmFromDate(new Date("2025-07-01"))).toBe("2025-07");
  });

  it("isWithinRetention", () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 5);
    expect(isWithinRetention(future)).toBe(true);
    const past = new Date("2000-01-01");
    expect(isWithinRetention(past)).toBe(false);
  });
});

describe("ITC eligibility", () => {
  it("blocks food/entertainment by default", () => {
    expect(isItcEligibleCategory("food")).toBe(false);
    expect(isItcEligibleCategory("misc")).toBe(true);
    expect(isItcEligibleCategory("food", true)).toBe(true);
    expect(isItcEligibleCategory("misc", false)).toBe(false);
  });
});

describe("portal CSV parse", () => {
  it("parses header + rows", () => {
    const csv = [
      "gstin,name,inum,idt,txval,cgst,sgst,igst,val,pos",
      "07AAAAA0000A1Z5,Acme,INV-1,15-06-2025,10000,900,900,0,11800,07",
    ].join("\n");
    const rows = parseInwardCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ctin).toBe("07AAAAA0000A1Z5");
    expect(rows[0]!.txval).toBe(10000);
    expect(rows[0]!.camt).toBe(900);
  });
});
