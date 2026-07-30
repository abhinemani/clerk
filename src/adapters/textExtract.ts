/**
 * Text extraction (spec §6.5 "a document is never unsearchable"; invariant 1's
 * verification tool).
 *
 * Pure, dependency-free extraction for the formats the platform handles today:
 *  - plain-text families (txt/md/csv/json/log) — decoded directly;
 *  - PDF text layers — literal strings shown by Tj/TJ/' operators, including
 *    FlateDecode-compressed content streams (inflated via node:zlib).
 *
 * Best-effort by design: a scanned/image PDF yields nothing, and the caller
 * must treat "no extractable text" as a hard stop for redaction — a document
 * whose text we cannot see is a document we cannot certify as redacted.
 *
 * This same function runs over FINALIZED redacted artifacts in the invariant
 * test suite: extract the release bytes and assert the redacted strings are
 * gone (docs/invariants.md #1).
 */
import { inflateSync } from "node:zlib";

export interface ExtractedText {
  lines: string[];
  pageCount: number;
}

const TEXT_MIME = /^text\/|\/(json|csv|xml|markdown)$|\+json$|\+xml$/i;

/** Extract a text rendition from stored bytes, or null when there is none. */
export function extractText(bytes: Buffer, mimeType: string | null): ExtractedText | null {
  const mime = (mimeType ?? "").toLowerCase();
  const looksPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";

  if (looksPdf || mime === "application/pdf") return extractPdfText(bytes);

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
