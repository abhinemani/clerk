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
  spansFromDragRect,
  suggestRedactionsFromPii,
  wordMatches,
  wordSpanAt,
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

describe("spansFromDragRect — multi-line selection geometry", () => {
  const lengths = [20, 0, 15, 30]; // line 1 is empty

  it("a single-line drag yields one span", () => {
    expect(spansFromDragRect(lengths, { line: 0, col: 4 }, { line: 0, col: 9 })).toEqual([
      { line: 0, startCol: 4, endCol: 9 },
    ]);
  });

  it("a multi-line drag covers anchor-to-EOL, whole middles, and SOL-to-focus", () => {
    expect(spansFromDragRect(lengths, { line: 0, col: 5 }, { line: 3, col: 7 })).toEqual([
      { line: 0, startCol: 5, endCol: 20 },
      { line: 2, startCol: 0, endCol: 15 }, // line 1 is empty — contributes nothing
      { line: 3, startCol: 0, endCol: 7 },
    ]);
  });

  it("is direction-agnostic — dragging up equals dragging down", () => {
    const down = spansFromDragRect(lengths, { line: 0, col: 5 }, { line: 2, col: 3 });
    const up = spansFromDragRect(lengths, { line: 2, col: 3 }, { line: 0, col: 5 });
    expect(up).toEqual(down);
  });

  it("clamps past-the-end columns and lines to the document", () => {
    // Anchor starts past the end of line 0, so line 0 contributes nothing;
    // the drag still runs through the (clamped) last line.
    expect(spansFromDragRect(lengths, { line: 0, col: 999 }, { line: 99, col: 999 })).toEqual([
      { line: 2, startCol: 0, endCol: 15 },
      { line: 3, startCol: 0, endCol: 30 },
    ]);
  });

  it("a zero-width drag selects nothing", () => {
    expect(spansFromDragRect(lengths, { line: 2, col: 5 }, { line: 2, col: 5 })).toEqual([]);
  });

  it("spans it produces are burnable — applyRedactions removes exactly that text", () => {
    const lines = ["Reporting party: Jane Doe", "SSN: 123-45-6789"];
    const spans = spansFromDragRect(lines.map((l) => l.length), { line: 0, col: 17 }, { line: 1, col: 16 });
    const released = applyRedactions(lines, spans);
    expect(released.join("\n")).not.toContain("Jane Doe");
    expect(released.join("\n")).not.toContain("123-45-6789");
    expect(released[0]).toContain("Reporting party: "); // kept text survives
  });
});

describe("wordSpanAt — double-click-to-redact geometry", () => {
  const lines = [
    "Reporting party:  Jane A. Doe",
    "Email: jane.doe@example.com  SSN: 123-45-6789",
    "   ",
  ];

  it("selects the whole word under the point", () => {
    // Click in the middle of "Jane" (line 0, cols 18–22).
    expect(wordSpanAt(lines, { line: 0, col: 20 })).toEqual({ line: 0, startCol: 18, endCol: 22 });
  });

  it("treats punctuation-joined tokens as one word — emails and SSNs redact in one click", () => {
    expect(wordSpanAt(lines, { line: 1, col: 12 })).toEqual({ line: 1, startCol: 7, endCol: 27 });
    expect(wordSpanAt(lines, { line: 1, col: 38 })).toEqual({ line: 1, startCol: 34, endCol: 45 });
  });

  it("returns null on whitespace, blank lines, and off-document points", () => {
    expect(wordSpanAt(lines, { line: 0, col: 16 })).toBeNull(); // between the two spaces
    expect(wordSpanAt(lines, { line: 2, col: 1 })).toBeNull();
    expect(wordSpanAt(lines, { line: 99, col: 0 })).toBeNull();
  });

  it("clicking past the end of a line selects its last word", () => {
    expect(wordSpanAt(lines, { line: 0, col: 999 })).toEqual({ line: 0, startCol: 26, endCol: 29 });
  });

  it("produces burnable spans — the word is gone from the release", () => {
    const span = wordSpanAt(lines, { line: 0, col: 20 })!;
    const released = applyRedactions(lines, [span]);
    expect(released[0]).not.toContain("Jane");
    expect(released[0]).toContain("Doe"); // only the clicked word burns
  });
});

describe("wordMatches — redact-this-word-everywhere geometry", () => {
  const doc = [
    "Officer Reyes interviewed Ann Walsh at the scene.",
    "ann walsh stated that Reyes arrived first.",
    "The Walsh statement (Walsh, p.2) is attached.",
    "",
    "SSN 123-45-6789 appears twice: 123-45-6789.",
  ];

  it("finds every occurrence, case-insensitively, through adjacent punctuation", () => {
    const hits = wordMatches(doc, "Walsh");
    expect(hits).toEqual([
      { line: 0, startCol: 30, endCol: 35 },
      { line: 1, startCol: 4, endCol: 9 },
      { line: 2, startCol: 4, endCol: 9 },
      { line: 2, startCol: 21, endCol: 26 }, // "(Walsh," — punctuation is a boundary
    ]);
  });

  it("respects word boundaries — no substring over-redaction", () => {
    const hits = wordMatches(["Ann met Anna at the Anniversary."], "Ann");
    expect(hits).toEqual([{ line: 0, startCol: 0, endCol: 3 }]);
  });

  it("punctuation-joined needles (SSNs) match everywhere they appear", () => {
    const hits = wordMatches(doc, "123-45-6789");
    expect(hits).toEqual([
      { line: 4, startCol: 4, endCol: 15 },
      { line: 4, startCol: 31, endCol: 42 }, // "123-45-6789." — the period is a boundary
    ]);
  });

  it("agrees with wordSpanAt: the double-clicked word is one of its own matches", () => {
    const span = wordSpanAt(doc, { line: 1, col: 6 })!; // "walsh"
    const word = doc[1]!.slice(span.startCol, span.endCol);
    expect(wordMatches(doc, word)).toContainEqual(span);
  });

  it("burns clean everywhere — no occurrence survives the release", () => {
    const hits = wordMatches(doc, "Walsh");
    const released = applyRedactions([...doc], hits);
    expect(findLeaks(released, redactedValues(doc, hits))).toEqual([]);
    expect(released.join("\n")).not.toMatch(/Walsh/i);
  });

  it("rejects empty and multi-word needles", () => {
    expect(wordMatches(doc, "")).toEqual([]);
    expect(wordMatches(doc, "Ann Walsh")).toEqual([]);
  });
});
