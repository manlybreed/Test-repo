import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/mail/credential-crypto";

const TEST_KEY = "oadKMtmw6DZGLHgIPSf2dIxK1MuwsrTyB58nxLaHDNM="; // 32 bytes, base64 — test-only, not a real secret
const originalKey = process.env.MAIL_CREDENTIALS_KEY;

describe("credential-crypto", () => {
  beforeEach(() => {
    process.env.MAIL_CREDENTIALS_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.MAIL_CREDENTIALS_KEY;
    else process.env.MAIL_CREDENTIALS_KEY = originalKey;
  });

  it("round-trips a plaintext password exactly", () => {
    const plain = "correct horse battery staple";
    const enc = encryptSecret(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV, not deterministic)", () => {
    const plain = "same-password";
    const a = encryptSecret(plain);
    const b = encryptSecret(plain);
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(plain);
    expect(decryptSecret(b)).toBe(plain);
  });

  it("rejects a tampered ciphertext instead of silently returning garbage", () => {
    const enc = encryptSecret("a-real-password");
    const buf = Buffer.from(enc, "base64");
    // Flip a byte inside the ciphertext portion (after the 12-byte IV + 16-byte auth tag).
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws a clear error when MAIL_CREDENTIALS_KEY is not set", () => {
    delete process.env.MAIL_CREDENTIALS_KEY;
    expect(() => encryptSecret("x")).toThrow(/MAIL_CREDENTIALS_KEY/);
  });

  it("throws a clear error when the key doesn't decode to 32 bytes", () => {
    process.env.MAIL_CREDENTIALS_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
