import { afterEach, describe, expect, it } from "vitest";
import { ceoMailConfigured, getCeoMailConfig } from "@/lib/mail/ceo-config";

const keys = [
  "CEO_MAIL_USER",
  "CEO_MAIL_PASS",
  "CEO_MAIL_HOST",
  "CEO_MAIL_SMTP_PORT",
  "CEO_MAIL_IMAP_PORT",
  "CEO_MAIL_FROM",
] as const;

const saved: Record<string, string | undefined> = {};

afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function stash() {
  for (const k of keys) saved[k] = process.env[k];
}

describe("ceo-config", () => {
  it("returns null when missing credentials", () => {
    stash();
    delete process.env.CEO_MAIL_USER;
    delete process.env.CEO_MAIL_PASS;
    expect(getCeoMailConfig()).toBeNull();
    expect(ceoMailConfigured()).toBe(false);
  });

  it("defaults host and ports 587/993 for akshay@", () => {
    stash();
    process.env.CEO_MAIL_USER = "akshay@thebluridge.com";
    process.env.CEO_MAIL_PASS = "secret";
    delete process.env.CEO_MAIL_HOST;
    delete process.env.CEO_MAIL_SMTP_PORT;
    delete process.env.CEO_MAIL_IMAP_PORT;
    const cfg = getCeoMailConfig();
    expect(cfg?.user).toBe("akshay@thebluridge.com");
    expect(cfg?.host).toBe("mail.thebluridge.com");
    expect(cfg?.smtpPort).toBe(587);
    expect(cfg?.imapPort).toBe(993);
    expect(cfg?.imapSecure).toBe(true);
  });
});
