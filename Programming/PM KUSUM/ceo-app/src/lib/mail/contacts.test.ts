import { describe, expect, it } from "vitest";
import {
  isRealName,
  nameFromLocalPart,
  personNeedles,
  rankContacts,
} from "@/lib/mail/contacts";

function contact(over: Partial<Parameters<typeof rankContacts>[0][number]> = {}) {
  return {
    address: "a@x.com",
    displayName: null,
    namesJson: "[]",
    messageCount: 0,
    lastMessageAt: null,
    ...over,
  };
}

describe("R2 contacts", () => {
  it("splits a person reference into needles, dropping tiny tokens", () => {
    expect(personNeedles("Ramesh Kumar")).toEqual(["ramesh", "kumar"]);
    expect(personNeedles("billing@mail.anthropic.com")).toEqual([
      "billing@mail.anthropic.com",
    ]);
    expect(personNeedles("a")).toEqual([]);
  });

  it("ranks more token hits above fewer, then frequency", () => {
    const rows = [
      contact({ address: "ramesh@vendor.in", displayName: "Ramesh Kumar", messageCount: 2 }),
      contact({ address: "ramesh2@other.in", displayName: "Ramesh", messageCount: 50 }),
    ];
    const [top] = rankContacts(rows, personNeedles("Ramesh Kumar"), 5);
    // Two-token hit wins despite the other's higher message count.
    expect(top.address).toBe("ramesh@vendor.in");
  });

  it("breaks equal-hit ties by message frequency", () => {
    const rows = [
      contact({ address: "loud@anthropic.com", displayName: "Anthropic", messageCount: 40 }),
      contact({ address: "quiet@anthropic.com", displayName: "Anthropic", messageCount: 3 }),
    ];
    const [top] = rankContacts(rows, personNeedles("anthropic"), 5);
    expect(top.address).toBe("loud@anthropic.com");
  });

  it("drops rows with no needle hit", () => {
    const rows = [
      contact({ address: "sbi@sbi.co.in", displayName: "SBI" }),
      contact({ address: "random@x.com", displayName: "Someone" }),
    ];
    const out = rankContacts(rows, personNeedles("sbi"), 5);
    expect(out).toHaveLength(1);
    expect(out[0]!.address).toBe("sbi@sbi.co.in");
  });

  it("isRealName rejects a name that's just the address restated", () => {
    expect(isRealName("himanshu@thebluridge.com", "himanshu@thebluridge.com")).toBe(false);
    expect(isRealName("Himanshu@TheBluRidge.com", "himanshu@thebluridge.com")).toBe(false);
    expect(isRealName(null, "himanshu@thebluridge.com")).toBe(false);
    expect(isRealName("", "himanshu@thebluridge.com")).toBe(false);
    expect(isRealName("Himanshu Sharma", "himanshu@thebluridge.com")).toBe(true);
  });

  it("nameFromLocalPart derives a plausible name from the email address", () => {
    expect(nameFromLocalPart("himanshu@thebluridge.com")).toBe("Himanshu");
    expect(nameFromLocalPart("john.doe@company.com")).toBe("John Doe");
    expect(nameFromLocalPart("jane_smith123@company.com")).toBe("Jane Smith");
    expect(nameFromLocalPart("Ramesh-Kumar@vendor.in")).toBe("Ramesh Kumar");
  });

  it("nameFromLocalPart returns null for role/shared mailboxes rather than guessing", () => {
    expect(nameFromLocalPart("noreply@company.com")).toBeNull();
    expect(nameFromLocalPart("info@company.com")).toBeNull();
    expect(nameFromLocalPart("accounts@thebluridge.com")).toBeNull();
    expect(nameFromLocalPart("support@company.com")).toBeNull();
    expect(nameFromLocalPart("12345@company.com")).toBeNull();
  });
});
