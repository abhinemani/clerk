/**
 * Extraction + rendition tests — the tooling behind invariant 1: we must be
 * able to read back what a released artifact actually contains.
 */
import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MAX_ZIP_MEMBER_BYTES, extractPdfImages, extractText, openZipArchive } from "./textExtract";
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

describe("extractPdfImages — the OCR feed for scanned PDFs", () => {
  it("returns DCTDecode stream bytes as JPEGs, in order", () => {
    const jpeg1 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const jpeg2 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    const pdf = Buffer.concat([
      Buffer.from("%PDF-1.4\n", "latin1"),
      Buffer.from(`2 0 obj << /Subtype /Image /Filter /DCTDecode /Length ${jpeg1.length} >> stream\n`, "latin1"),
      jpeg1,
      Buffer.from("\nendstream endobj\n", "latin1"),
      Buffer.from(`3 0 obj << /Subtype /Image /Filter /DCTDecode /Length ${jpeg2.length} >> stream\n`, "latin1"),
      jpeg2,
      Buffer.from("\nendstream endobj\n%%EOF", "latin1"),
    ]);
    const images = extractPdfImages(pdf);
    expect(images).toHaveLength(2);
    expect(images[0]!.mimeType).toBe("image/jpeg");
    expect(Buffer.compare(images[0]!.bytes, jpeg1)).toBe(0);
    expect(Buffer.compare(images[1]!.bytes, jpeg2)).toBe(0);
  });

  it("ignores non-image and non-DCT streams, and non-PDF bytes", () => {
    const content = "BT (hello) Tj ET";
    const pdf = Buffer.from(
      `%PDF-1.4\n2 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj\n%%EOF`,
      "latin1",
    );
    expect(extractPdfImages(pdf)).toEqual([]);
    expect(extractPdfImages(Buffer.from("not a pdf"))).toEqual([]);
  });
});

// --- DOCX fixtures: a real zip, built by hand ------------------------------

/** Minimal valid zip: local headers + central directory + EOCD, real CRCs. */
function buildZip(entries: { name: string; data: string; stored?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const raw = Buffer.from(e.data, "utf8");
    const body = e.stored ? raw : deflateRawSync(raw);
    const method = e.stored ? 0 : 8;
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += 30 + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function buildDocx(bodyXml: string, opts: { pages?: number; stored?: boolean } = {}): Buffer {
  const entries = [
    {
      name: "word/document.xml",
      data:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${bodyXml}</w:body></w:document>`,
      stored: opts.stored,
    },
  ];
  if (opts.pages) {
    entries.push({
      name: "docProps/app.xml",
      data: `<?xml version="1.0"?><Properties><Pages>${opts.pages}</Pages></Properties>`,
      stored: opts.stored,
    });
  }
  return buildZip(entries);
}

describe("extractText — DOCX", () => {
  it("extracts paragraphs from a deflated docx", () => {
    const docx = buildDocx(
      `<w:p><w:r><w:t>MEMORANDUM</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>To: </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>City Council</w:t></w:r></w:p>`,
    );
    const out = extractText(docx, DOCX_MIME);
    expect(out?.lines).toEqual(["MEMORANDUM", "To: City Council"]);
    expect(out?.pageCount).toBe(1);
  });

  it("detects docx by zip content when the mime is octet-stream", () => {
    const docx = buildDocx(`<w:p><w:r><w:t>attached via email</w:t></w:r></w:p>`);
    const out = extractText(docx, "application/octet-stream");
    expect(out?.lines).toEqual(["attached via email"]);
  });

  it("renders tabs, breaks, empty paragraphs, and XML entities", () => {
    const docx = buildDocx(
      `<w:p><w:r><w:t>Name:</w:t><w:tab/><w:t>Smith &amp; Sons &#8212; d/b/a &quot;S&#x26;S&quot;</w:t></w:r></w:p>` +
        `<w:p/>` +
        `<w:p><w:r><w:t>before</w:t><w:br/><w:t>after</w:t></w:r></w:p>`,
    );
    const out = extractText(docx, DOCX_MIME);
    expect(out?.lines).toEqual(['Name:\tSmith & Sons — d/b/a "S&S"', "", "before", "after"]);
  });

  it("preserves xml:space text runs and reads the app.xml page count", () => {
    const docx = buildDocx(`<w:p><w:r><w:t xml:space="preserve">  indented  </w:t></w:r></w:p>`, { pages: 7 });
    const out = extractText(docx, DOCX_MIME);
    expect(out?.lines).toEqual(["  indented  "]);
    expect(out?.pageCount).toBe(7);
  });

  it("reads stored (uncompressed) zip entries too", () => {
    const docx = buildDocx(`<w:p><w:r><w:t>stored entry</w:t></w:r></w:p>`, { stored: true });
    expect(extractText(docx, DOCX_MIME)?.lines).toEqual(["stored entry"]);
  });

  it("flattens table cells to one line per cell", () => {
    const docx = buildDocx(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Case No.</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>2025-04182</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    );
    expect(extractText(docx, DOCX_MIME)?.lines).toEqual(["Case No.", "2025-04182"]);
  });

  it("returns null for a zip that is not a docx, and for a claimed docx that is unreadable", () => {
    const zip = buildZip([{ name: "readme.txt", data: "just a zip" }]);
    expect(extractText(zip, "application/zip")).toBeNull();
    expect(extractText(Buffer.from("PK\x03\x04garbage"), DOCX_MIME)).toBeNull();
  });
});

describe("openZipArchive — decompression bomb guard", () => {
  /** buildZip for Buffer payloads (the string helper would double memory). */
  function buildZipRaw(entries: { name: string; raw: Buffer }[]): Buffer {
    const chunks: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const body = deflateRawSync(e.raw);
      const name = Buffer.from(e.name, "utf8");
      const crc = crc32(e.raw);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(e.raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      chunks.push(local, name, body);
      const cen = Buffer.alloc(46);
      cen.writeUInt32LE(0x02014b50, 0);
      cen.writeUInt16LE(20, 6);
      cen.writeUInt16LE(8, 10);
      cen.writeUInt32LE(crc, 16);
      cen.writeUInt32LE(body.length, 20);
      cen.writeUInt32LE(e.raw.length, 24);
      cen.writeUInt16LE(name.length, 28);
      cen.writeUInt32LE(offset, 42);
      central.push(cen, name);
      offset += 30 + name.length + body.length;
    }
    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, centralBuf, eocd]);
  }

  it("refuses a member that inflates past the ceiling; honest members still read", () => {
    // ~100 KB of deflate that wants to become >100 MB of zeros.
    const bomb = Buffer.alloc(MAX_ZIP_MEMBER_BYTES + 1);
    const zip = openZipArchive(
      buildZipRaw([
        { name: "bomb.bin", raw: bomb },
        { name: "honest.txt", raw: Buffer.from("fine") },
      ]),
    );
    expect(zip).not.toBeNull();
    expect(zip!.read("bomb.bin")).toBeNull(); // aborted, treated as corrupt
    expect(zip!.read("honest.txt")?.toString("utf8")).toBe("fine");
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
