/**
 * Human-friendly request identifiers (spec §5): `PR-2026-00341`.
 *
 * Pure formatting/parsing. Sequence allocation (the per-agency, per-year counter)
 * is a DB concern handled at insert time; these helpers just format and parse.
 */
const PUBLIC_ID_RE = /^PR-(\d{4})-(\d{5,})$/;

export function formatPublicId(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new RangeError(`formatPublicId: year must be a 4-digit integer, got ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError(`formatPublicId: sequence must be a non-negative integer, got ${sequence}`);
  }
  return `PR-${year}-${sequence.toString().padStart(5, "0")}`;
}

export interface ParsedPublicId {
  year: number;
  sequence: number;
}

export function parsePublicId(publicId: string): ParsedPublicId | null {
  const m = PUBLIC_ID_RE.exec(publicId);
  if (!m) return null;
  return { year: Number(m[1]), sequence: Number(m[2]) };
}

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_RE.test(value);
}
