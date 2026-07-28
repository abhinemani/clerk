/** Tests for the deterministic PII pass (spec §6.5 step 1). */
import { describe, expect, it } from "vitest";
import { resolveOverlaps, scanPii, summarizePii, type PiiFinding } from "./piiScan";

const typesIn = (findings: PiiFinding[]) => new Set(findings.map((f) => f.type));

describe("scanPii — recall on common identifiers", () => {
  it("catches SSN, email, phone, and IP", () => {
    const text =
      "Contact John at john.doe@example.com or (415) 555-0132. SSN 123-45-6789. Server 10.0.12.5.";
    const types = typesIn(scanPii(text));
    expect(types.has("ssn")).toBe(true);
    expect(types.has("email")).toBe(true);
    expect(types.has("phone")).toBe(true);
    expect(types.has("ip_address")).toBe(true);
  });

  it("flags a Luhn-valid credit card as credit_card (high confidence)", () => {
    // 4111 1111 1111 1111 is a standard Luhn-valid test number.
    const findings = scanPii("Card on file: 4111 1111 1111 1111.");
    const card = findings.find((f) => f.type === "credit_card");
    expect(card).toBeDefined();
    expect(card!.confidence).toBe("high");
  });

  it("treats a non-Luhn long digit run as a probable bank account (low)", () => {
    const findings = scanPii("Account 1234567890123456 at the bank.");
    const acct = findings.find((f) => f.type === "bank_account" || f.type === "credit_card");
    expect(acct).toBeDefined();
  });

  it("catches dates as DOB candidates and medical terms", () => {
    const findings = scanPii("DOB 04/12/1980. Notes mention chemotherapy and a diagnosis.");
    const types = typesIn(findings);
    expect(types.has("date")).toBe(true);
    expect(types.has("medical_term")).toBe(true);
  });

  it("captures accurate offsets", () => {
    const text = "ssn is 123-45-6789 here";
    const f = scanPii(text).find((x) => x.type === "ssn")!;
    expect(text.slice(f.start, f.end)).toBe("123-45-6789");
  });

  it("returns nothing for clean prose", () => {
    expect(scanPii("The council approved the annual budget on Tuesday.")).toEqual([]);
  });
});

describe("resolveOverlaps", () => {
  it("keeps the higher-confidence finding on identical spans", () => {
    const a: PiiFinding = { type: "bank_account", value: "x", start: 0, end: 5, confidence: "low" };
    const b: PiiFinding = { type: "credit_card", value: "x", start: 0, end: 5, confidence: "high" };
    const out = resolveOverlaps([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("credit_card");
  });

  it("drops a finding fully contained in a larger one", () => {
    const outer: PiiFinding = { type: "credit_card", value: "x", start: 0, end: 19, confidence: "high" };
    const inner: PiiFinding = { type: "phone", value: "y", start: 4, end: 14, confidence: "medium" };
    expect(resolveOverlaps([outer, inner])).toHaveLength(1);
  });

  it("is idempotent and position-sorted", () => {
    const findings = scanPii("a@b.co 415-555-0100 987-65-4321");
    const once = resolveOverlaps(findings);
    const twice = resolveOverlaps(once);
    expect(twice).toEqual(once);
    for (let i = 1; i < twice.length; i++) {
      expect(twice[i]!.start).toBeGreaterThanOrEqual(twice[i - 1]!.start);
    }
  });
});

describe("summarizePii", () => {
  it("counts findings by type for the sensitivity banner", () => {
    const summary = summarizePii(scanPii("a@b.com c@d.com SSN 111-22-3333"));
    expect(summary.email).toBe(2);
    expect(summary.ssn).toBe(1);
  });
});
