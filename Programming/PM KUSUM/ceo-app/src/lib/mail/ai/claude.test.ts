import { describe, expect, it } from "vitest";
import { parseJsonFromModelText } from "@/lib/mail/ai/claude";

describe("parseJsonFromModelText", () => {
  it("parses raw JSON", () => {
    expect(parseJsonFromModelText('{"answer":"hi","citations":[]}')).toEqual({
      answer: "hi",
      citations: [],
    });
  });

  it("strips fences", () => {
    expect(
      parseJsonFromModelText('```json\n{"answer":"x","notFound":false}\n```'),
    ).toEqual({ answer: "x", notFound: false });
  });

  it("extracts object from prose preamble", () => {
    const raw =
      'Based on the mail, here is the result:\n{"answer":"SBI POS reply pending","citations":["m1"],"notFound":false}\nHope that helps.';
    expect(parseJsonFromModelText(raw)).toEqual({
      answer: "SBI POS reply pending",
      citations: ["m1"],
      notFound: false,
    });
  });

  it("throws when no JSON present", () => {
    expect(() => parseJsonFromModelText("Based on the mail I found nothing.")).toThrow(
      /No JSON/,
    );
  });
});
