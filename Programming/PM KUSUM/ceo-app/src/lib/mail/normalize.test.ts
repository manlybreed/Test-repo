import { describe, expect, it } from "vitest";
import {
  htmlToText,
  normalizeSubject,
  snippetFromBody,
  threadKey,
} from "@/lib/mail/normalize";

describe("normalize", () => {
  it("strips html and normalizes subjects", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p>")).toContain("Hello");
    expect(normalizeSubject("Re: Fee note")).toBe("Fee note");
  });

  it("threads via in-reply-to / references", () => {
    expect(
      threadKey({
        inReplyTo: "<a@b>",
        references: "<x@y> <a@b>",
        subject: "Re: Hi",
      }),
    ).toBe("<a@b>");
    expect(threadKey({ subject: "Hello" })).toMatch(/^subj:/);
  });

  it("snippets truncate", () => {
    expect(snippetFromBody("a".repeat(200), 20).endsWith("…")).toBe(true);
  });
});
