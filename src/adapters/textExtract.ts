/**
 * Text extraction (spec §6.5 "a document is never unsearchable"; invariant 1's
 * verification tool).
 *
 * Pure, dependency-free extraction for the formats the platform handles today:
 *  - plain-text families (txt/md/csv/json/log) — decoded directly;
 *  - PDF text layers — literal strings shown by Tj/TJ/' operators, including
 *    FlateDecode-compressed content streams (inflated via node:zlib);
 *  - DOCX — a zip of XML; word/document.xml is located with a minimal zip
 *    reader (node:zlib inflateRawSync) and flattened to paragraph lines.
 *
 * Best-effort by design: a scanned/image PDF yields nothing here (the OCR
 * adapter picks those up asynchronously — see src/adapters/ocr.ts), and the
 * caller must treat "no extractable text" as a hard stop for redaction — a
 * document whose text we cannot see is a document we cannot certify as
 * redacted.
 *
 * This same function runs over FINALIZED redacted artifacts in the invariant
 * test suite: extract the release bytes and assert the redacted strings are
 * gone (docs/invariants.md #1).
 */
import { inflateRawSync, inflateSync } from "node:zlib";

export interface ExtractedText {
  lines: string[];
  pageCount: number;
}

const TEXT_MIME = /^text\/|\/(json|csv|xml|markdown)$|\+json$|\+xml$/i;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Extract a text rendition from stored bytes, or null when there is none. */
export function extractText(bytes: Buffer, mimeType: string | null): ExtractedText | null {
  const mime = (mimeType ?? "").toLowerCase();
  const looksPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";

  if (looksPdf || mime === "application/pdf") return extractPdfText(bytes);

  // DOCX detection is by content, not just mime — email gateways and legacy
  // systems routinely ship .docx as application/octet-stream.
  const looksZip = bytes.subarray(0, 4).toString("latin1") === "PK\x03\x04";
  if (looksZip || mime === DOCX_MIME) {
    const docx = extractDocxText(bytes);
    if (docx) return docx;
    if (mime === DOCX_MIME) return null; // claimed docx but unreadable — don't fall through
  }

  if (TEXT_MIME.test(mime) || (!mime && isMostlyPrintable(bytes))) {
    const text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return { lines, pageCount: 1 };
  }

  return null;
}

function isMostlyPrintable(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, 2048);
  if (sample.length === 0) return false;
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  return printable / sample.length > 0.95;
}

// --- PDF -------------------------------------------------------------------

function extractPdfText(bytes: Buffer): ExtractedText | null {
  const raw = bytes.toString("latin1");
  const pageCount = countPages(raw);

  const lines: string[] = [];
  for (const stream of contentStreams(bytes)) {
    lines.push(...linesFromContentStream(stream));
  }

  if (lines.length === 0) return null;
  return { lines, pageCount: Math.max(pageCount, 1) };
}

function countPages(raw: string): number {
  // "/Type /Page" but not "/Pages" — whitespace between name tokens optional.
  const matches = raw.match(/\/Type\s*\/Page(?![s\w])/g);
  return matches?.length ?? 0;
}

/** Every stream body, inflated when its object dictionary says FlateDecode. */
function contentStreams(bytes: Buffer): string[] {
  const raw = bytes.toString("latin1");
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    // The dictionary immediately precedes the `stream` keyword.
    const dictStart = raw.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : "";
    let body = bytes.subarray(start, end);
    // Streams end with an EOL before `endstream`; strip it, not stream bytes.
    if (body[body.length - 1] === 0x0a) body = body.subarray(0, body.length - 1);
    if (body[body.length - 1] === 0x0d) body = body.subarray(0, body.length - 1);
    if (/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(dict)) {
      try {
        out.push(inflateSync(body).toString("latin1"));
      } catch {
        // Corrupt or unsupported — skip this stream, keep the rest.
      }
    } else if (!/\/Filter/.test(dict)) {
      out.push(body.toString("latin1"));
    }
    re.lastIndex = end;
  }
  return out;
}

/**
 * Text-showing operators → lines. Each BT…ET block is treated as a paragraph;
 * within it, the line-move operators (Td, TD, T-star, quote) start a new line
 * and Tj/TJ append to the current one.
 */
function linesFromContentStream(content: string): string[] {
  const lines: string[] = [];
  const btRe = /BT([\s\S]*?)ET/g;
  let bt: RegExpExecArray | null;
  while ((bt = btRe.exec(content))) {
    const block = bt[1]!;
    let current: string | null = null;
    // Tokens we care about, in order: literal strings w/ operator, or line moves.
    const tokRe = /\(((?:\\.|[^\\()])*)\)\s*(Tj|')|\[((?:\((?:\\.|[^\\()])*\)|[^\]])*)\]\s*TJ|T\*|-?[\d.]+\s+-?[\d.]+\s+(?:Td|TD)/g;
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(block))) {
      const tok = t[0]!;
      if (tok === "T*" || /(?:Td|TD)$/.test(tok)) {
        if (current !== null) lines.push(current);
        current = null;
        // `'` moves to the next line before showing — fall through below.
        if (!/'$/.test(tok)) continue;
      }
      if (t[1] !== undefined) {
        // (string) Tj or (string) '
        if (/'\s*$/.test(tok) && current !== null) {
          lines.push(current);
          current = null;
        }
        current = (current ?? "") + unescapePdfString(t[1]);
      } else if (t[3] !== undefined) {
        // [ (a) -120 (b) ] TJ — concatenate the string elements
        const parts = [...t[3].matchAll(/\(((?:\\.|[^\\()])*)\)/g)].map((p) => unescapePdfString(p[1]!));
        current = (current ?? "") + parts.join("");
      }
    }
    if (current !== null) lines.push(current);
  }
  return lines;
}

/**
 * Embedded raster images from a PDF, in document order — the OCR feed for
 * scanned PDFs. DCTDecode streams are literal JPEG bytes, which is what every
 * consumer scanner and copier emits; other encodings (CCITT, JBIG2, JPX) are
 * rare in municipal scans and degrade honestly to "no text".
 */
export function extractPdfImages(bytes: Buffer): { bytes: Buffer; mimeType: string }[] {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return [];
  const raw = bytes.toString("latin1");
  const images: { bytes: Buffer; mimeType: string }[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const dictStart = raw.lastIndexOf("<<", m.index);
    const dict = dictStart >= 0 ? raw.slice(dictStart, m.index) : "";
    if (/\/Subtype\s*\/Image/.test(dict) && /\/Filter\s*(?:\[\s*)?\/DCTDecode/.test(dict)) {
      let body = bytes.subarray(start, end);
      if (body[body.length - 1] === 0x0a) body = body.subarray(0, body.length - 1);
      if (body[body.length - 1] === 0x0d) body = body.subarray(0, body.length - 1);
      images.push({ bytes: Buffer.from(body), mimeType: "image/jpeg" });
    }
    re.lastIndex = end;
  }
  return images;
}

// --- DOCX ------------------------------------------------------------------

/**
 * DOCX is a zip archive; the body text lives in word/document.xml as
 * WordprocessingML. A minimal zip reader (end-of-central-directory → central
 * directory → local headers, inflateRawSync for deflate entries) keeps this
 * dependency-free.
 */
function extractDocxText(bytes: Buffer): ExtractedText | null {
  const entries = readZipEntries(bytes);
  if (!entries) return null;

  const documentXml = readZipEntry(bytes, entries, "word/document.xml");
  if (!documentXml) return null;

  const lines = docxXmlToLines(documentXml.toString("utf8"));
  if (lines.length === 0) return null;

  // Word records a page count in docProps/app.xml; absent (or zero — some
  // generators never paginate), fall back to 1.
  let pageCount = 1;
  const appXml = readZipEntry(bytes, entries, "docProps/app.xml");
  if (appXml) {
    const m = appXml.toString("utf8").match(/<Pages>(\d+)<\/Pages>/);
    if (m) pageCount = Math.max(parseInt(m[1]!, 10), 1);
  }

  return { lines, pageCount };
}

interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  localHeaderOffset: number;
}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function readZipEntries(bytes: Buffer): Map<string, ZipEntry> | null {
  // EOCD is at the end, preceded by an up-to-64KB comment; scan backwards.
  const scanFloor = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= scanFloor; i--) {
    if (bytes.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);

  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== CENTRAL_SIG) return null;
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLen).toString("utf8");
    entries.set(name, { name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(bytes: Buffer, entries: Map<string, ZipEntry>, name: string): Buffer | null {
  const entry = entries.get(name);
  if (!entry) return null;
  const at = entry.localHeaderOffset;
  if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== LOCAL_SIG) return null;
  // Local-header name/extra lengths can differ from the central directory's.
  const nameLen = bytes.readUInt16LE(at + 26);
  const extraLen = bytes.readUInt16LE(at + 28);
  const dataStart = at + 30 + nameLen + extraLen;
  const body = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  try {
    if (entry.method === 8) return inflateRawSync(body);
    if (entry.method === 0) return Buffer.from(body);
  } catch {
    // Corrupt entry — treat as absent.
  }
  return null;
}

/**
 * WordprocessingML → lines. Each <w:p> paragraph is a line (table cells are
 * paragraphs too, so tables flatten to one line per cell); within a paragraph,
 * <w:t> runs concatenate, <w:tab/> becomes a tab, and <w:br/>/<w:cr/> split
 * the paragraph into additional lines. Everything else is markup and drops.
 */
function docxXmlToLines(xml: string): string[] {
  const lines: string[] = [];
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
  let p: RegExpExecArray | null;
  while ((p = paraRe.exec(xml))) {
    let text = "";
    const tokRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g;
    let t: RegExpExecArray | null;
    while ((t = tokRe.exec(p[0]!))) {
      if (t[1] !== undefined) text += decodeXmlEntities(t[1]);
      else if (t[0] === "<w:tab/>") text += "\t";
      else text += "\n";
    }
    for (const line of text.split("\n")) lines.push(line);
  }
  // Trim trailing empty paragraphs but keep interior blank lines (paragraph
  // breaks carry meaning in letters and memos).
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    switch (ent) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return whole;
    }
  });
}

function unescapePdfString(s: string): string {
  return s.replace(/\\(\d{1,3}|.)/g, (_, esc: string) => {
    if (/^\d/.test(esc)) return String.fromCharCode(parseInt(esc, 8) & 0xff);
    switch (esc) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "b": return "\b";
      case "f": return "\f";
      default: return esc; // \\, \(, \), and anything else → the char itself
    }
  });
}
