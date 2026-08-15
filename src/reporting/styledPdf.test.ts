/** Tests for the styled PDF engine (executive-report substrate). */
import { describe, expect, it } from "vitest";
import { PAGE_H, StyledPdf, rgb } from "./styledPdf";

const latin1 = (buf: Buffer) => buf.toString("latin1");

describe("rgb", () => {
  it("parses hex to 0–1 triples and rejects junk", () => {
    expect(rgb("#ffffff")).toEqual([1, 1, 1]);
    expect(rgb("#000000")).toEqual([0, 0, 0]);
    const [r, g, b] = rgb("#f5c75e");
    expect(r).toBeCloseTo(245 / 255);
    expect(g).toBeCloseTo(199 / 255);
    expect(b).toBeCloseTo(94 / 255);
    expect(() => rgb("gold")).toThrow();
    expect(() => rgb("#fff")).toThrow();
  });
});

describe("measurement and wrapping", () => {
  const pdf = new StyledPdf({ title: "t" });

  it("widthOf uses real Helvetica metrics (bold is wider, i is narrow)", () => {
    expect(pdf.widthOf("iii", "regular", 10)).toBeLessThan(pdf.widthOf("mmm", "regular", 10));
    expect(pdf.widthOf("Hello", "bold", 10)).toBeGreaterThan(pdf.widthOf("Hello", "regular", 10));
    // Known value: "Hi" regular 10pt = (722 + 222) / 1000 * 10.
    expect(pdf.widthOf("Hi", "regular", 10)).toBeCloseTo(9.44);
  });

  it("wraps greedily at word boundaries and never exceeds the max width", () => {
    const lines = pdf.wrap("the quick brown fox jumps over the lazy dog", "regular", 10, 90);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(pdf.widthOf(line, "regular", 10)).toBeLessThanOrEqual(90);
    expect(lines.join(" ")).toBe("the quick brown fox jumps over the lazy dog");
  });

  it("hard-breaks a single overlong token instead of overflowing", () => {
    const token = "a".repeat(120);
    const lines = pdf.wrap(token, "regular", 10, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(pdf.widthOf(line, "regular", 10)).toBeLessThanOrEqual(100);
    expect(lines.join("")).toBe(token);
  });

  it("preserves explicit newlines", () => {
    expect(pdf.wrap("one\ntwo", "regular", 10, 500)).toEqual(["one", "two"]);
  });
});

describe("document assembly", () => {
  it("produces a parseable single-page PDF with fonts, xref and trailer", () => {
    const pdf = new StyledPdf({ title: "Test report", background: rgb("#f7f7f5") });
    pdf.textLine("Hello world", { font: "bold", size: 14 });
    const buf = pdf.finalize();
    const s = latin1(buf);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("/Type /Catalog");
    expect((s.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(1);
    expect(s).toContain("/BaseFont /Helvetica-Bold");
    expect(s).toContain("/Encoding /WinAnsiEncoding");
    expect(s).toContain("Hello world");
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    // Background fill op present on the page.
    expect(s).toContain("0 0 612 792 re f");
  });

  it("flows onto new pages and fires the page-break hook (not on page one)", () => {
    let breaks = 0;
    const pdf = new StyledPdf({ title: "t", onPageBreak: () => breaks++ });
    for (let i = 0; i < 120; i++) pdf.textLine(`line ${i}`);
    const s = latin1(pdf.finalize());
    const pageCount = (s.match(/\/Type \/Page[^s]/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    expect(breaks).toBe(pageCount - 1);
  });

  it("draws footers with the real page count on every page", () => {
    const seen: Array<{ page: number; pageCount: number }> = [];
    const pdf = new StyledPdf({
      title: "t",
      footer: (p, input) => {
        seen.push(input);
        p.drawTextAt(p.marginX, PAGE_H - 30, `Page ${input.page} of ${input.pageCount}`, { size: 7 });
      },
    });
    for (let i = 0; i < 120; i++) pdf.textLine(`line ${i}`);
    const s = latin1(pdf.finalize());
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((x) => x.pageCount === seen.length)).toBe(true);
    expect(s).toContain(`Page 1 of ${seen.length}`);
    expect(s).toContain(`Page ${seen.length} of ${seen.length}`);
  });

  it("encodes typographic characters as WinAnsi bytes and escapes PDF specials", () => {
    const pdf = new StyledPdf({ title: "em—dash (test)" });
    pdf.textLine("volume — up · done (really)");
    const s = latin1(pdf.finalize());
    // Em dash → WinAnsi 0x97, middle dot → 0xB7; parens escaped.
    expect(s).toContain(`volume ${String.fromCharCode(0x97)} up ${String.fromCharCode(0xb7)} done \\(really\\)`);
    // Unknown glyphs degrade to "?" rather than corrupting the stream.
    const pdf2 = new StyledPdf({ title: "t" });
    pdf2.textLine("snow ☃ man");
    expect(latin1(pdf2.finalize())).toContain("snow ? man");
  });

  it("ensureSpace breaks the page exactly when the block would not fit", () => {
    const pdf = new StyledPdf({ title: "t" });
    pdf.cursor = PAGE_H - pdf.marginBottom - 10;
    pdf.ensureSpace(9); // fits
    expect(pdf.pageNumber).toBe(1);
    pdf.ensureSpace(50); // does not fit
    expect(pdf.pageNumber).toBe(2);
    expect(pdf.cursor).toBe(pdf.marginTop);
  });
});
