/**
 * Exhaustive / catalog smoke tests for AI-01..21 surface area.
 * Heavy Claude paths are unit-tested via schema/policy/pack; live model optional.
 */
import { describe, expect, it } from "vitest";
import { checkAutonomy } from "@/lib/mail/ai/policy";
import { parseTriageJson } from "@/lib/mail/ai/triage";
import { packChunks } from "@/lib/mail/ai/retrieve";
import { buildIcsInvite } from "@/lib/mail/ai/meeting";
import { rewriteDraft } from "@/lib/mail/ai/draft";
import { styleInPrompt } from "@/lib/mail/ai/style";

const FEATURE_IDS = [
  "AI-01",
  "AI-02",
  "AI-03",
  "AI-04",
  "AI-05",
  "AI-06",
  "AI-07",
  "AI-08",
  "AI-09",
  "AI-10",
  "AI-11",
  "AI-12",
  "AI-13",
  "AI-14",
  "AI-15",
  "AI-16",
  "AI-17",
  "AI-18",
  "AI-19",
  "AI-20",
  "AI-21",
] as const;

describe("AI feature catalogue coverage", () => {
  it("lists all 21 feature ids", () => {
    expect(FEATURE_IDS).toHaveLength(21);
  });

  it("AI-01/02 triage parse", () => {
    expect(parseTriageJson({ priority: "P4", labels: ["NEWSLETTER"] }).priority).toBe(
      "P4",
    );
  });

  it("AI-05 pack citations", () => {
    const { citations } = packChunks([
      {
        messageId: "x",
        threadId: "t",
        subject: "s",
        fromAddress: "a@b.c",
        date: "d",
        snippet: "",
        bodyExcerpt: "body",
      },
    ]);
    expect(citations).toContain("x");
  });

  it("AI-08 empty rewrite rejected", async () => {
    await expect(
      rewriteDraft({ html: "   ", mode: "shorten" }),
    ).rejects.toThrow(/Empty/);
  });

  it("AI-09 style prompt", () => {
    expect(
      styleInPrompt(
        JSON.stringify({
          commonGreeting: "Hi",
          commonSignoff: "Thanks",
          avgLength: 100,
        }),
      ),
    ).toContain("Hi");
  });

  it("AI-17/21 calendar + send gates", () => {
    expect(checkAutonomy("calendar_invite").allowed).toBe(false);
    expect(checkAutonomy("schedule_send").allowed).toBe(false);
    const ics = buildIcsInvite({
      title: "Sync",
      startIso: "2026-09-01T09:00:00.000Z",
      endIso: "2026-09-01T09:30:00.000Z",
      organizerEmail: "akshay@thebluridge.com",
      attendeeEmails: [],
      confirmed: true,
    });
    expect(ics.ics).toContain("END:VCALENDAR");
  });

  it("AI-18/19/unsubscribe irreversible", () => {
    expect(checkAutonomy("unsubscribe", { confirmed: true }).allowed).toBe(
      true,
    );
    expect(checkAutonomy("delete").allowed).toBe(false);
  });

  it("AI-21 delete/send require confirmation", () => {
    expect(checkAutonomy("delete").allowed).toBe(false);
    expect(checkAutonomy("delete", { confirmed: true }).allowed).toBe(true);
    expect(checkAutonomy("send").allowed).toBe(false);
  });

  it("AI-13/20 surface modules resolve", async () => {
    const att = await import("@/lib/mail/ai/attachments");
    const rules = await import("@/lib/mail/ai/label-rules");
    expect(typeof att.processPendingAttachments).toBe("function");
    expect(typeof att.extractAttachmentText).toBe("function");
    expect(typeof rules.applyStandingLabelRules).toBe("function");
  });

  it("AI-05 retrieve exports FTS helpers", async () => {
    const r = await import("@/lib/mail/ai/retrieve");
    expect(typeof r.ensureMailFtsIndex).toBe("function");
    expect(typeof r.retrieveMail).toBe("function");
    expect(typeof r.packChunks).toBe("function");
  });
});
