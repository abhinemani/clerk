/**
 * Records CSV import (docs/records-ingestion.md §1) — pure parsing for the
 * bulk RECORDS pipe (documents into the corpus), distinct from the legacy
 * REQUEST importer. Same tolerant philosophy: reject a row, never the file,
 * and always say why. Reuses the legacy importer's CSV tokenizer and date
 * parser rather than growing a second dialect.
 *
 * Deliberately NO classification column: a bulk import can never say
 * "public" — every imported record lands internal, and only the named-human
 * publish (or an explicitly configured auto-publish source) crosses that
 * line. Parsing enforces the invariant by having no way to express it.
 */
import { parseCsvTable, parseLegacyDate } from "./legacyImport";

const HEADER_SYNONYMS: Record<string, string[]> = {
  externalId: ["external_id", "externalid", "id", "record_id", "reference"],
  title: ["title", "name", "record_title", "document_title", "subject"],
  summary: ["summary", "description", "abstract", "notes"],
  date: ["date", "record_date", "document_date", "released", "released_on", "meeting_date"],
  recordType: ["record_type", "recordtype", "type", "category"],
  tags: ["tags", "tag"],
  keywords: ["keywords", "keyword", "search_terms"],
  filename: ["filename", "file", "file_name", "attachment"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function buildHeaderIndex(headerRow: string[]): Map<string, number> {
  const bySynonym = new Map<string, string>();
  for (const [canonical, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    for (const s of synonyms) bySynonym.set(s, canonical);
  }
  const index = new Map<string, number>();
  headerRow.forEach((raw, i) => {
    const canonical = bySynonym.get(normalizeHeader(raw));
    if (canonical && !index.has(canonical)) index.set(canonical, i); // first match wins
  });
  return index;
}

/** Split a "a; b, c" style cell into clean list items. */
function parseList(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export interface ParsedRecordRow {
  /** 1-based, matching what a spreadsheet user sees, header row excluded. */
  rowNumber: number;
  externalId: string | null;
  title: string;
  summary: string | null;
  /** The record's own date (meeting date, release date) — not the import date. */
  date: Date | null;
  recordType: string | null;
  tags: string[];
  keywords: string[];
  /** Expected member name in the companion ZIP; null = metadata-only entry. */
  filename: string | null;
  warnings: string[];
}

export interface RecordsImportRowError {
  rowNumber: number;
  reason: string;
}

export interface RecordsImportParseResult {
  rows: ParsedRecordRow[];
  errors: RecordsImportRowError[];
  missingHeaders: string[];
}

/** Parse a records-inventory CSV into import-ready rows. Pure; no I/O. */
export function parseRecordsCsv(csvText: string): RecordsImportParseResult {
  const table = parseCsvTable(csvText.trim());
  if (table.length === 0) return { rows: [], errors: [], missingHeaders: ["title"] };

  const [headerRow, ...dataRows] = table;
  const index = buildHeaderIndex(headerRow!);
  const missingHeaders = index.has("title") ? [] : ["title"];

  const get = (row: string[], field: string): string => {
    const i = index.get(field);
    return i != null ? (row[i] ?? "").trim() : "";
  };

  const rows: ParsedRecordRow[] = [];
  const errors: RecordsImportRowError[] = [];
  const seenExternalIds = new Set<string>();

  dataRows.forEach((row, i) => {
    const rowNumber = i + 1;
    if (row.every((c) => c.trim() === "")) return; // truly blank row — skip silently

    const title = get(row, "title");
    if (!title) {
      errors.push({ rowNumber, reason: "Missing title — nothing to file the record under." });
      return;
    }

    const warnings: string[] = [];

    let date: Date | null = null;
    const dateRaw = get(row, "date");
    if (dateRaw) {
      date = parseLegacyDate(dateRaw);
      if (!date) warnings.push(`Unrecognized date "${dateRaw}" (use YYYY-MM-DD or MM/DD/YYYY) — left blank.`);
    }

    const externalId = get(row, "externalId") || null;
    if (externalId) {
      if (seenExternalIds.has(externalId)) {
        errors.push({ rowNumber, reason: `Duplicate external_id "${externalId}" — a later row already covers it.` });
        return;
      }
      seenExternalIds.add(externalId);
    }

    rows.push({
      rowNumber,
      externalId,
      title: title.slice(0, 300),
      summary: get(row, "summary").slice(0, 2000) || null,
      date,
      recordType: get(row, "recordType") || null,
      tags: parseList(get(row, "tags")),
      keywords: parseList(get(row, "keywords")),
      filename: get(row, "filename") || null,
      warnings,
    });
  });

  return { rows, errors, missingHeaders };
}

/**
 * A title from a bare filename — for the ad-hoc "just drop files, no
 * spreadsheet" upload path (no CSV row exists to carry one). Strips the
 * extension and directory, and turns separators into spaces so
 * "council_minutes-2026_06.pdf" reads as "council minutes 2026 06" rather
 * than surfacing the raw filename as the record's title.
 */
export function titleFromFilename(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const noExt = base.replace(/\.[a-zA-Z0-9]{1,8}$/, "");
  const spaced = noExt.replace(/[_-]+/g, " ").trim();
  return (spaced || base).slice(0, 300);
}

/**
 * Synthesize a row for one directly-uploaded file — same shape a CSV row
 * would produce, but with everything besides title/filename left for the
 * auto-classification job (§6.5) to suggest once the file lands.
 */
export function rowFromUploadedFile(filename: string, rowNumber: number): ParsedRecordRow {
  return {
    rowNumber,
    externalId: null,
    title: titleFromFilename(filename),
    summary: null,
    date: null,
    recordType: null,
    tags: [],
    keywords: [],
    filename,
    warnings: [],
  };
}

/** The template an office can fill in — headers this parser recognizes. */
export const RECORDS_CSV_TEMPLATE = [
  "external_id,title,summary,date,record_type,tags,keywords,filename",
  'AGENDA-2026-14,"City Council agenda, June 2, 2026","Regular session agenda with staff reports",2026-06-02,agenda,"council; agenda","council meeting agenda june",agenda-2026-06-02.pdf',
  ',"Paving schedule, summer 2026","Planned street resurfacing by neighborhood",2026-05-20,schedule,"public works","paving streets resurfacing",',
].join("\n");
