/**
 * Styled PDF engine — the typeset counterpart to domain/textPdf.ts.
 *
 * Same design constraint as that file: dependency-free, byte-level PDF
 * assembly, pure function of its inputs. Where textPdf renders a monospace
 * text rendition (right for release artifacts and defensibility exhibits),
 * this engine does real layout — proportional Helvetica with measured
 * wrapping, filled/stroked rectangles, rules, and multi-page flow — for
 * artifacts a clerk hands to an executive.
 *
 * It uses only the PDF standard-14 fonts (Helvetica, -Bold, -Oblique), so no
 * font bytes are embedded and every viewer renders it. Text is encoded as
 * WinAnsi: ASCII passes through, the common typographic characters the house
 * copy uses (em/en dash, curly quotes, ellipsis, bullet, middle dot) map to
 * their WinAnsi bytes, anything else degrades to "?" rather than breaking
 * the stream.
 *
 * Coordinates: callers work in "distance from the top of the page" (like
 * CSS); the engine converts to PDF's bottom-left origin at emit time.
 */

export type Rgb = readonly [number, number, number];

/** "#rrggbb" → 0–1 RGB triple (compile-time constants; throws on bad input). */
export function rgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`rgb(): expected #rrggbb, got "${hex}"`);
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export type FontId = "regular" | "bold" | "oblique";

export const PAGE_W = 612; // US Letter, points
export const PAGE_H = 792;

// Helvetica AFM widths (1/1000 em) for chars 32–126. Oblique shares the
// regular metrics; that is true of the real AFM files, not an approximation.
// prettier-ignore
const WIDTHS_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// prettier-ignore
const WIDTHS_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Typographic chars the house copy uses → [WinAnsi byte, regular w, bold w]. */
const WINANSI_EXTRAS: Record<string, [number, number, number]> = {
  "—": [0x97, 1000, 1000], // — em dash
  "–": [0x96, 556, 556], // – en dash
  "‘": [0x91, 222, 278], // ‘
  "’": [0x92, 222, 278], // ’
  "“": [0x93, 333, 500], // “
  "”": [0x94, 333, 500], // ”
  "…": [0x85, 1000, 1000], // …
  "•": [0x95, 350, 350], // •
  "·": [0xb7, 278, 278], // ·
};
const FALLBACK_WIDTH = 556;

function charMetrics(ch: string, font: FontId): { byte: number; width: number } {
  const code = ch.charCodeAt(0);
  const boldish = font === "bold";
  if (code >= 32 && code <= 126) {
    const table = boldish ? WIDTHS_BOLD : WIDTHS_REGULAR;
    return { byte: code, width: table[code - 32]! };
  }
  const extra = WINANSI_EXTRAS[ch];
  if (extra) return { byte: extra[0], width: boldish ? extra[2] : extra[1] };
  // Latin-1 letters (é, ñ, …) share their WinAnsi code point; width is
  // approximated — wrapping stays safe because the estimate is generous.
  if (code >= 0xa0 && code <= 0xff) return { byte: code, width: FALLBACK_WIDTH };
  return { byte: 0x3f /* ? */, width: boldish ? 611 : 556 };
}

export interface TextOpts {
  font?: FontId;
  size?: number;
  color?: Rgb;
  /** Extra spacing between characters, in points (for letterspaced eyebrows). */
  charSpace?: number;
}

interface FooterInput {
  page: number;
  pageCount: number;
}

export interface StyledPdfOptions {
  title: string;
  /** Page background fill; omit for plain white. */
  background?: Rgb;
  marginX?: number;
  marginTop?: number;
  marginBottom?: number;
  /** Called on every page after finalize (page count is known); draw footers here. */
  footer?: (pdf: StyledPdf, input: FooterInput) => void;
  /** Called when a new page opens mid-flow (NOT the first page) — repeat any running header. */
  onPageBreak?: (pdf: StyledPdf) => void;
}

const FONT_KEYS: Record<FontId, string> = { regular: "F1", bold: "F2", oblique: "F3" };

export class StyledPdf {
  readonly marginX: number;
  readonly marginTop: number;
  readonly marginBottom: number;
  /** Current flow cursor, measured from the TOP of the page. */
  cursor: number;

  private readonly opts: StyledPdfOptions;
  private pages: string[][] = [];
  private pageIndex = 0;
  private finalizing = false;

  constructor(opts: StyledPdfOptions) {
    this.opts = opts;
    this.marginX = opts.marginX ?? 54;
    this.marginTop = opts.marginTop ?? 54;
    this.marginBottom = opts.marginBottom ?? 60;
    this.cursor = this.marginTop;
    this.pages.push([]);
    this.paintBackground();
  }

  get contentWidth(): number {
    return PAGE_W - 2 * this.marginX;
  }
  get pageNumber(): number {
    return this.pageIndex + 1;
  }

  // --- measurement ---------------------------------------------------------

  widthOf(text: string, font: FontId = "regular", size = 10, charSpace = 0): number {
    let units = 0;
    for (const ch of text) units += charMetrics(ch, font).width;
    return (units / 1000) * size + Math.max(0, text.length - 1) * charSpace;
  }

  /** Greedy word wrap to a max width; a single overlong word is hard-broken. */
  wrap(text: string, font: FontId = "regular", size = 10, maxWidth = this.contentWidth): string[] {
    const out: string[] = [];
    for (const rawLine of text.split("\n")) {
      const words = rawLine.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let line = "";
      for (let word of words) {
        while (this.widthOf(word, font, size) > maxWidth && word.length > 1) {
          // Overlong token (a URL, an id): break off what fits.
          let cut = word.length - 1;
          while (cut > 1 && this.widthOf(line ? `${line} ${word.slice(0, cut)}` : word.slice(0, cut), font, size) > maxWidth) cut--;
          const head = word.slice(0, cut);
          out.push(line ? `${line} ${head}` : head);
          line = "";
          word = word.slice(cut);
        }
        const candidate = line ? `${line} ${word}` : word;
        if (this.widthOf(candidate, font, size) <= maxWidth) {
          line = candidate;
        } else {
          if (line) out.push(line);
          line = word;
        }
      }
      if (line) out.push(line);
    }
    return out;
  }

  // --- primitives (yTop = distance from top of page) -----------------------

  fillRect(x: number, yTop: number, w: number, h: number, color: Rgb): void {
    this.op(`${c3(color)} rg ${f(x)} ${f(PAGE_H - yTop - h)} ${f(w)} ${f(h)} re f`);
  }

  strokeRect(x: number, yTop: number, w: number, h: number, color: Rgb, lineWidth = 0.75): void {
    this.op(`${c3(color)} RG ${f(lineWidth)} w ${f(x)} ${f(PAGE_H - yTop - h)} ${f(w)} ${f(h)} re S`);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb, lineWidth = 0.75): void {
    this.op(`${c3(color)} RG ${f(lineWidth)} w ${f(x1)} ${f(PAGE_H - y1)} m ${f(x2)} ${f(PAGE_H - y2)} l S`);
  }

  /**
   * Single line of text whose BASELINE sits `yTop` points from the page top.
   * Callers doing flow layout should prefer paragraph()/textLine().
   */
  drawTextAt(x: number, yTop: number, text: string, opts: TextOpts = {}): void {
    const font = opts.font ?? "regular";
    const size = opts.size ?? 10;
    const color = opts.color ?? ([0, 0, 0] as const);
    const charSpace = opts.charSpace ?? 0;
    const encoded = escapePdfString(encodeWinAnsi(text));
    this.op(
      `BT /${FONT_KEYS[font]} ${f(size)} Tf ${c3(color)} rg ${charSpace !== 0 ? `${f(charSpace)} Tc ` : ""}${f(x)} ${f(PAGE_H - yTop)} Td (${encoded}) Tj${charSpace !== 0 ? " 0 Tc" : ""} ET`,
    );
  }

  // --- flow layout ---------------------------------------------------------

  /** Start a fresh page (repeats background; fires onPageBreak outside finalize). */
  addPage(): void {
    this.pages.push([]);
    this.pageIndex = this.pages.length - 1;
    this.paintBackground();
    this.cursor = this.marginTop;
    if (!this.finalizing) this.opts.onPageBreak?.(this);
  }

  /** Guarantee `height` points of room at the cursor; page-break if not. */
  ensureSpace(height: number): void {
    if (this.cursor + height > PAGE_H - this.marginBottom) this.addPage();
  }

  moveDown(h: number): void {
    this.cursor += h;
  }

  /** One measured line at the cursor (no wrapping), advancing by `leading`. */
  textLine(text: string, opts: TextOpts & { x?: number; leading?: number } = {}): void {
    const size = opts.size ?? 10;
    const leading = opts.leading ?? size * 1.35;
    this.ensureSpace(leading);
    this.drawTextAt(opts.x ?? this.marginX, this.cursor + size * 0.8, text, opts);
    this.cursor += leading;
  }

  /** Wrapped text at the cursor, breaking pages as needed. */
  paragraph(text: string, opts: TextOpts & { x?: number; maxWidth?: number; leading?: number } = {}): void {
    const size = opts.size ?? 10;
    const x = opts.x ?? this.marginX;
    const maxWidth = opts.maxWidth ?? PAGE_W - this.marginX - x;
    const leading = opts.leading ?? size * 1.4;
    for (const line of this.wrap(text, opts.font ?? "regular", size, maxWidth)) {
      this.ensureSpace(leading);
      this.drawTextAt(x, this.cursor + size * 0.8, line, opts);
      this.cursor += leading;
    }
  }

  // --- assembly ------------------------------------------------------------

  finalize(): Buffer {
    // Footers are drawn last so the total page count is real, not estimated.
    this.finalizing = true;
    if (this.opts.footer) {
      const pageCount = this.pages.length;
      for (let i = 0; i < pageCount; i++) {
        this.pageIndex = i;
        this.opts.footer(this, { page: i + 1, pageCount });
      }
    }

    const objects: string[] = [];
    const fontIds: Record<FontId, number> = { regular: 3, bold: 4, oblique: 5 };
    const firstPageObj = 6;
    const pageObjIds = this.pages.map((_, i) => firstPageObj + i * 2);

    objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
    objects.push(
      `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${this.pages.length} >>`,
    );
    const baseFonts: Record<FontId, string> = {
      regular: "Helvetica",
      bold: "Helvetica-Bold",
      oblique: "Helvetica-Oblique",
    };
    for (const id of ["regular", "bold", "oblique"] as const) {
      objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${baseFonts[id]} /Encoding /WinAnsiEncoding >>`);
    }
    const fontRes = `<< ${(Object.keys(FONT_KEYS) as FontId[]).map((k) => `/${FONT_KEYS[k]} ${fontIds[k]} 0 R`).join(" ")} >>`;
    this.pages.forEach((ops, i) => {
      const contentId = firstPageObj + i * 2 + 1;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font ${fontRes} >> /Contents ${contentId} 0 R >>`,
      );
      const stream = ops.join("\n");
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
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${escapePdfString(encodeWinAnsi(this.opts.title))}) >> >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    return Buffer.from(body, "latin1");
  }

  private paintBackground(): void {
    if (this.opts.background) {
      this.op(`${c3(this.opts.background)} rg 0 0 ${PAGE_W} ${PAGE_H} re f`);
    }
  }

  private op(s: string): void {
    this.pages[this.pageIndex]!.push(s);
  }
}

/** String of WinAnsi code points (each char ≤ 0xFF, latin1-safe to emit). */
function encodeWinAnsi(text: string): string {
  let out = "";
  for (const ch of text) out += String.fromCharCode(charMetrics(ch, "regular").byte);
  return out;
}

function escapePdfString(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "\\" || ch === "(" || ch === ")") out += `\\${ch}`;
    else out += ch;
  }
  return out;
}

function f(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function c3(color: Rgb): string {
  return `${f(round3(color[0]))} ${f(round3(color[1]))} ${f(round3(color[2]))}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
