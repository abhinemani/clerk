/**
 * Extraction + rendition tests — the tooling behind invariant 1: we must be
 * able to read back what a released artifact actually contains.
 */
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractText } from "./textExtract";
import { renderTextPdf, MAX_COLS } from "@/domain/textPdf";
import { applyRedactions, findLeaks, redactedValues } from "@/domain/redaction";

describe("extractText — plain text", () => {
  it("decodes text files into lines", () => {
    const out = extractText(Buffer.from("line one\r\nline two\nline three\n", "utf8"), "text/plain");
    expect(out?.lines).toEqual(["line one", "line two", "line three"]);
    expect(out?.pageCount).toBe(1);
  });

  it("sniffs printable content when the mime type is missing", () => {
    const out = extractText(Buffer.from("hello world", "utf8"), null);
    expect(out?.lines).toEqual(["hello world"]);
  });

  it("returns null for binary junk", () => {
    const out = extractText(Buffer.from([0, 1, 2, 255, 254, 253, 7, 8, 0, 0]), "application/octet-stream");
    expect(out).toBeNull();
  });
});

describe("extractText — PDF", () => {
  it("reads an uncompressed text-layer PDF (the seed's own format)", () => {
    const pdf = renderTextPdf(["RIVERTON POLICE DEPARTMENT", "Case No. 2025-04182"]);
    const out = extractText(pdf, "application/pdf");
    expect(out?.lines).toEqual(["RIVERTON POLICE DEPARTMENT", "Case No. 2025-04182"]);
    expect(out?.pageCount).toBe(1);
  });

  it("inflates FlateDecode content streams", () => {
    const content = "BT /F1 12 Tf 54 700 Td (compressed secret text) Tj ET";
    const deflated = deflateSync(Buffer.from(content, "latin1"));
    const pdf = Buffer.concat([
      Buffer.from(
        "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
          "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
          "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n" +
          `4 0 obj << /Length ${deflated.length} /Filter /FlateDecode >> stream\n`,
        "latin1",
      ),
      deflated,
      Buffer.from("\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF", "latin1"),
    ]);
    const out = extractText(pdf, "application/pdf");
    expect(out?.lines).toEqual(["compressed secret text"]);
  });

  it("handles escaped parens and TJ arrays", () => {
    const content = "BT [(Hello \\(sir\\)) -250 ( and)] TJ ET BT (line \\\\two) Tj ET";
    const pdf = Buffer.from(
      `%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n2 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n%%EOF`,
      "latin1",
    );
    const out = extractText(pdf, "application/pdf");
    expect(out?.lines).toEqual(["Hello (sir) and", "line \\two"]);
  });

  it("returns null for a PDF with no text layer (scan-like)", () => {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF", "latin1");
    expect(extractText(pdf, "application/pdf")).toBeNull();
  });
});

describe("renderTextPdf — the redacted rendition", () => {
  it("round-trips content through render → extract", () => {
    const lines = ["Alpha bravo charlie", "", "Delta echo — with (parens) and \\slashes\\"];
    const out = extractText(renderTextPdf(lines), "application/pdf");
    // Blank lines don't survive (nothing is drawn for them) — content does.
    expect(out?.lines).toEqual(["Alpha bravo charlie", "Delta echo — with (parens) and \\slashes\\".replace("—", " ")]);
  });

  it("paginates long documents", () => {
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);
    const pdf = renderTextPdf(lines);
    const out = extractText(pdf, "application/pdf");
    expect(out?.pageCount).toBe(3); // 52 lines/page
    expect(out?.lines[0]).toBe("line 1");
    expect(out?.lines[119]).toBe("line 120");
  });

  it("wraps lines longer than the grid without losing characters", () => {
    const long = "x".repeat(MAX_COLS + 10);
    const out = extractText(renderTextPdf([long]), "application/pdf");
    expect(out?.lines.join("")).toBe(long);
  });

  it("INVARIANT 1: redacted values are absent from the rendered artifact", () => {
    const lines = [
      "Reporting party: Jane A. Doe",
      "SSN: 123-45-6789   Phone: (415) 555-0132",
      "Narrative: vehicle damaged overnight.",
    ];
    const spans = [
      { line: 0, startCol: 17, endCol: 28 }, // Jane A. Doe
      { line: 1, startCol: 5, endCol: 16 }, // the SSN
      { line: 1, startCol: 26, endCol: 40 }, // the phone number
    ];
    const values = redactedValues(lines, spans);
    expect(values).toContain("Jane A. Doe");
    expect(values).toContain("123-45-6789");

    const released = applyRedactions(lines, spans);
    const pdf = renderTextPdf(released);

    // The mandated check: extract the FINAL artifact bytes; nothing redacted
    // may be recoverable — not via findLeaks, not via raw byte search.
    const extracted = extractText(pdf, "application/pdf");
    expect(extracted).not.toBeNull();
    expect(findLeaks(extracted!.lines, values)).toEqual([]);
    const raw = pdf.toString("latin1");
    for (const v of values) expect(raw).not.toContain(v);

    // The kept content is still there.
    expect(extracted!.lines.join("\n")).toContain("vehicle damaged overnight");
  });
});
