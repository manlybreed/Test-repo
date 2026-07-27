import { describe, expect, it } from "vitest";
import { parseMailVoiceCommand } from "@/lib/mail/voice-commands";

describe("parseMailVoiceCommand", () => {
  it("recognizes compose phrasing", () => {
    expect(parseMailVoiceCommand("compose a new email")).toEqual({
      type: "compose",
    });
    expect(parseMailVoiceCommand("write a new message")).toEqual({
      type: "compose",
    });
    expect(parseMailVoiceCommand("new email")).toEqual({ type: "compose" });
  });

  it("recognizes folder navigation with a nav verb", () => {
    expect(parseMailVoiceCommand("open trash")).toEqual({
      type: "openFolder",
      folder: "TRASH",
    });
    expect(parseMailVoiceCommand("go to sent")).toEqual({
      type: "openFolder",
      folder: "SENT",
    });
    expect(parseMailVoiceCommand("show me the drafts")).toEqual({
      type: "openFolder",
      folder: "DRAFTS",
    });
    expect(parseMailVoiceCommand("switch to the smart inbox")).toEqual({
      type: "openFolder",
      folder: "SMART_INBOX",
    });
    expect(parseMailVoiceCommand("open junk")).toEqual({
      type: "openFolder",
      folder: "JUNK",
    });
  });

  it("recognizes a bare folder name with no nav verb", () => {
    expect(parseMailVoiceCommand("trash")).toEqual({
      type: "openFolder",
      folder: "TRASH",
    });
    expect(parseMailVoiceCommand("Archive")).toEqual({
      type: "openFolder",
      folder: "ARCHIVE",
    });
  });

  it("recognizes search phrasing and preserves the query's original case", () => {
    expect(parseMailVoiceCommand("search for Invoices")).toEqual({
      type: "search",
      query: "Invoices",
    });
    expect(parseMailVoiceCommand("find the SBI POS machine thread")).toEqual({
      type: "search",
      query: "the SBI POS machine thread",
    });
  });

  it("recognizes thread actions, checking reply-all before bare reply", () => {
    expect(parseMailVoiceCommand("reply all")).toEqual({ type: "replyAll" });
    expect(parseMailVoiceCommand("reply")).toEqual({ type: "reply" });
    expect(parseMailVoiceCommand("forward this")).toEqual({ type: "forward" });
    expect(parseMailVoiceCommand("archive this thread")).toEqual({
      type: "archive",
    });
    expect(parseMailVoiceCommand("delete this")).toEqual({ type: "trash" });
    expect(parseMailVoiceCommand("move to trash")).toEqual({ type: "trash" });
  });

  it("falls back to ask for anything that isn't a recognized command", () => {
    expect(parseMailVoiceCommand("what did Ranjeet Kumar want")).toEqual({
      type: "ask",
      question: "what did Ranjeet Kumar want",
    });
  });
});
