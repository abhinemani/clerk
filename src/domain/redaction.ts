/**
 * True redaction (spec §4, §6.5).
 *
 * "true redaction — burn black boxes ... then strip text under redaction
 *  regions. NEVER overlay-only redaction (the classic scandal)."
 *
 * The release copy is produced by REPLACING the redacted characters with a block
 * glyph — the original text is gone, not covered. `redactedValues` + `findLeaks`
 * back the mandated test: extract text from the redacted output and assert the
 * redacted strings are absent. Pure and testable; the studio UI renders on top.
 */
import { scanPii, type PiiType } from "@/ai/redaction/piiScan";

/** A redaction over a run of characters on one line (0-indexed, [start, end)). */
export interface RedactionSpan {
  line: number;
  startCol: number;
  endCol: number;
  reason?: string;
}

export interface SuggestedRedaction extends RedactionSpan {
  confidence: "low" | "medium" | "high";
  piiType: PiiType;
}

/** The block glyph the burned characters become. */
export const BLOCK = "█";

/** A caret position in the monospace document grid. */
export interface GridPoint {
  line: number;
  col: number;
}

/**
 * Convert a two-point drag (or keyboard selection) into per-line spans — the
 * geometry behind selecting a paragraph in one gesture.
 *
 * A span never crosses a line, because the burn works line by line: dragging
 * from the middle of line 3 to the middle of line 6 yields "line 3 from the
 * anchor to end-of-line", whole lines 4–5, and "line 6 up to the focus". Empty
 * lines contribute nothing (there is nothing to black out). Direction-agnostic:
 * dragging up produces the same spans as dragging down.
 */
export function spansFromDragRect(
  lineLengths: readonly number[],
  anchor: GridPoint,
  focus: GridPoint,
): RedactionSpan[] {
  const clampLine = (l: number) => Math.max(0, Math.min(l, lineLengths.length - 1));
  const a = { line: clampLine(anchor.line), col: Math.max(0, anchor.col) };
  const f = { line: clampLine(focus.line), col: Math.max(0, focus.col) };
  const [from, to] = a.line < f.line || (a.line === f.line && a.col <= f.col) ? [a, f] : [f, a];

  const spans: RedactionSpan[] = [];
  for (let line = from.line; line <= to.line; line++) {
    const len = lineLengths[line] ?? 0;
    const startCol = line === from.line ? Math.min(from.col, len) : 0;
    const endCol = line === to.line ? Math.min(to.col, len) : len;
    if (endCol > startCol) spans.push({ line, startCol, endCol });
  }
  return spans;
}

function clampSpan(len: number, s: RedactionSpan): { start: number; end: number } {
  const start = Math.max(0, Math.min(s.startCol, len));
  const end = Math.max(start, Math.min(s.endCol, len));
  return { start, end };
}

/**
 * Apply redactions to the document, returning the released lines with redacted
 * characters replaced by the block glyph. The underlying characters are removed
 * — reversing this cannot recover them.
 */
export function applyRedactions(lines: string[], spans: RedactionSpan[]): string[] {
  const byLine = new Map<number, RedactionSpan[]>();
  for (const s of spans) {
    const arr = byLine.get(s.line) ?? [];
    arr.push(s);
    byLine.set(s.line, arr);
  }
  return lines.map((text, i) => {
    const lineSpans = byLine.get(i);
    if (!lineSpans || lineSpans.length === 0) return text;
    const chars = [...text];
    for (const s of lineSpans) {
      const { start, end } = clampSpan(chars.length, s);
      for (let c = start; c < end; c++) chars[c] = BLOCK;
    }
    return chars.join("");
  });
}

/** The original substrings being redacted — for the exemption log and verification. */
export function redactedValues(lines: string[], spans: RedactionSpan[]): string[] {
  return spans
    .map((s) => {
      const text = lines[s.line] ?? "";
      const { start, end } = clampSpan(text.length, s);
      return text.slice(start, end);
    })
    .filter((v) => v.trim().length > 0);
}

/**
 * The mandated leak check (§4): any redacted value that still appears in the
 * released text. Empty result means the burn is clean.
 */
export function findLeaks(released: string[], values: string[]): string[] {
  const haystack = released.join("\n");
  return values.filter((v) => v.trim().length > 0 && haystack.includes(v));
}

// Map detected PII to a plain-language exemption reason for the suggestion.
const EXEMPTION_BY_TYPE: Record<PiiType, string> = {
  ssn: "Personal privacy — SSN",
  ein: "Confidential identifier",
  email: "Personal privacy — contact info",
  phone: "Personal privacy — contact info",
  credit_card: "Financial privacy",
  bank_account: "Financial privacy",
  drivers_license: "Personal privacy — ID number",
  ip_address: "Personal privacy",
  date: "Personal privacy — date of birth",
  medical_term: "Medical privacy",
};

/**
 * Run the deterministic PII pass over each line and turn findings into suggested
 * redaction regions with an exemption reason (§6.5 step 1 → studio suggestions).
 */
export function suggestRedactionsFromPii(lines: string[]): SuggestedRedaction[] {
  const out: SuggestedRedaction[] = [];
  lines.forEach((text, line) => {
    for (const f of scanPii(text)) {
      out.push({
        line,
        startCol: f.start,
        endCol: f.end,
        reason: EXEMPTION_BY_TYPE[f.type],
        confidence: f.confidence,
        piiType: f.type,
      });
    }
  });
  return out;
}
