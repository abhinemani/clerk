/**
 * Redaction tests (spec §4/§6.5) — including the mandated leak test:
 * "extract text from a redacted output and assert the redacted strings are gone."
 */
import { describe, expect, it } from "vitest";
import {
  applyRedactions,
  BLOCK,
  findLeaks,
  redactedValues,
  suggestRedactionsFromPii,
} from "./redaction";

const LINES = [
  "INCIDENT REPORT — 400 Main St",
  "Reporting party: Jane Doe  SSN 123-45-6789",
  "Contact: jane.doe@example.com  (415) 555-0132",
];

describe("applyRedactions — true redaction", () => {
  it("replaces redacted characters with the block glyph, removing the original text", () => {
    // Redact "123-45-6789" on line 1 (cols 31..42).
    const start = LINES[1]!.indexOf("123-45-6789");
    const released = applyRedactions(LINES, [
      { line: 1, startCol: start, endCol: start + "123-45-6789".length },
    ]);
    expect(released[1]).toContain(BLOCK);
    expect(released[1]).not.toContain("123-45-6789");
  });

  it("MANDATED LEAK TEST: no redacted value survives in the released text", () => {
    const spans = [
      spanOf(1, "123-45-6789"),
      spanOf(2, "jane.doe@example.com"),
      spanOf(2, "(415) 555-0132"),
    ];
    const released = applyRedactions(LINES, spans);
    const values = redactedValues(LINES, spans);
    expect(values).toHaveLength(3);
    // Extract text from the redacted output and assert every redacted string is gone.
    expect(findLeaks(released, values)).toEqual([]);
  });

  it("handles overlapping and out-of-bounds spans without leaking", () => {
    const spans = [
      { line: 1, startCol: 0, endCol: 999 }, // past end of line
      { line: 1, startCol: 10, endCol: 20 }, // overlaps
    ];
    const released = applyRedactions(LINES, spans);
    expect(released[1]).toBe(BLOCK.repeat(LINES[1]!.length));
    expect(findLeaks(released, ["Jane Doe"])).toEqual([]);
  });

  it("leaves untouched lines exactly as they were", () => {
    const released = applyRedactions(LINES, [spanOf(1, "123-45-6789")]);
    expect(released[0]).toBe(LINES[0]);
    expect(released[2]).toBe(LINES[2]);
  });
});

describe("suggestRedactionsFromPii", () => {
  it("surfaces SSN, email, and phone as suggested regions with exemption reasons", () => {
    const suggestions = suggestRedactionsFromPii(LINES);
    const types = suggestions.map((s) => s.piiType);
    expect(types).toContain("ssn");
    expect(types).toContain("email");
    expect(types).toContain("phone");
    const ssn = suggestions.find((s) => s.piiType === "ssn")!;
    expect(ssn.reason).toMatch(/privacy/i);
    // The suggested span actually covers the SSN.
    expect(LINES[ssn.line]!.slice(ssn.startCol, ssn.endCol)).toBe("123-45-6789");
  });

  it("applying the suggestions produces a leak-free release", () => {
    const spans = suggestRedactionsFromPii(LINES);
    const released = applyRedactions(LINES, spans);
    expect(findLeaks(released, redactedValues(LINES, spans))).toEqual([]);
  });
});

function spanOf(line: number, needle: string) {
  const start = LINES[line]!.indexOf(needle);
  return { line, startCol: start, endCol: start + needle.length };
}
