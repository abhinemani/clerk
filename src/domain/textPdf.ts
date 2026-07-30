/**
 * Text-rendition PDF renderer (spec §6.5 finalize; invariant 1).
 *
 * Turns redacted text lines into a REGENERATED PDF: the artifact is built from
 * scratch containing only the surviving characters, so redacted content isn't
 * "removed from" the file — it was never written into it. Redacted runs (the
 * BLOCK glyph from applyRedactions) become spaces in the text layer plus a
 * drawn black rectangle at the same monospace grid position: the release
 * *looks* like a classic redaction bar, and text extraction finds nothing
 * underneath, because there is nothing underneath.
 *
 * Pure function of its input — no dependencies beyond Buffer.
 */
import { BLOCK } from "./redaction";

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const FONT_SIZE = 10;
const LEADING = 13;
const CHAR_W = FONT_SIZE * 0.6; // Courier is exactly 600/1000 em wide
export const MAX_COLS = Math.floor((PAGE_W - 2 * MARGIN) / CHAR_W); // 84
const LINES_PER_PAGE = Math.floor((PAGE_H - 2 * MARGIN) / LEADING); // 52

/** Hard-wrap to the page's monospace grid; block glyphs survive the wrap. */
function wrapLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= MAX_COLS) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += MAX_COLS) out.push(line.slice(i, i + MAX_COLS));
  }
  return out;
}

function escapePdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else if (ch >= " " && ch <= "~") out += ch;
    else out += " "; // non-ASCII → blank; the rendition is plain-text by design
  }
  return out;
}

/**
 * Render lines to PDF bytes. Every run of BLOCK glyphs is emitted as spaces in
 * the text layer + a filled rectangle over the run's grid cells.
 */
export function renderTextPdf(lines: string[], title = "Released record"): Buffer {
  const wrapped = wrapLines(lines.length > 0 ? lines : [""]);
  const pages: string[][] = [];
  for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) {
    pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
  }

  // Build each page's content stream: black bars first, then the text runs.
  const contentStreams = pages.map((pageLines) => {
    const ops: string[] = [];
    pageLines.forEach((line, row) => {
      const yBase = PAGE_H - MARGIN - (row + 1) * LEADING;
      // Redaction bars: contiguous BLOCK runs → filled rects on the char grid.
      for (const run of blockRuns(line)) {
        const x = MARGIN + run.start * CHAR_W;
        const w = (run.end - run.start) * CHAR_W;
        ops.push(`0 0 0 rg ${fmt(x)} ${fmt(yBase - 2)} ${fmt(w)} ${fmt(LEADING - 2)} re f`);
      }
      const shown = line.replaceAll(BLOCK, " ");
      if (shown.trim().length > 0) {
        ops.push(`BT /F1 ${FONT_SIZE} Tf ${MARGIN} ${fmt(yBase)} Td (${escapePdfText(shown)}) Tj ET`);
      }
    });
    return ops.join("\n");
  });

  // Assemble the file with a real xref so ordinary viewers open it happily.
  const objects: string[] = [];
  const pageObjIds = pages.map((_, i) => 4 + i * 2); // page, then its contents
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`);
  pages.forEach((_, i) => {
    const contentId = 4 + i * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const stream = contentStreams[i]!;
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });

  let body = `%PDF-1.4\n%âãÏÓ\n`;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${escapePdfText(title)}) >> >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(body, "latin1");
}

function blockRuns(line: string): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  const chars = [...line];
  chars.forEach((ch, i) => {
    if (ch === BLOCK) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      runs.push({ start, end: i });
      start = -1;
    }
  });
  if (start >= 0) runs.push({ start, end: chars.length });
  return runs;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
