/**
 * Legacy request import (spec roadmap: "no office starts empty"). Pure
 * parsing + validation — no I/O, no repository — so the same logic backs
 * both the preview step and the actual import, with nothing re-implemented
 * between them.
 *
 * The importer is deliberately lenient: a records office's export from
 * NextRequest/GovQA/a spreadsheet will have messy headers and inconsistent
 * status strings. Reject a ROW, never the whole file, and always say why.
 */
import type { RequestStatus } from "./requestLifecycle";

// --- CSV tokenizer (RFC4180-ish: quoted fields, doubled-quote escaping,
// embedded commas/newlines, \r\n or \n line endings) ------------------------

export function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      endField();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue; // normalize \r\n and bare \r
    }
    if (c === "\n") {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // Final field/row, unless the file ended cleanly on a newline (nothing pending).
  if (field.length > 0 || row.length > 0) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === "")); // drop blank lines
}

// --- header mapping ----------------------------------------------------------

/** Canonical field → accepted header spellings (case/whitespace-insensitive). */
const HEADER_SYNONYMS: Record<string, string[]> = {
  legacyId: ["id", "legacy_id", "legacyid", "reference", "case_number", "tracking_number", "request_number"],
  requesterName: ["requester_name", "requestername", "name", "requester"],
  requesterEmail: ["requester_email", "requesteremail", "email"],
  description: ["description", "scope", "request", "summary", "subject", "request_description"],
  status: ["status"],
  receivedAt: ["filed_date", "date_filed", "received", "received_date", "date_received", "opened", "filed"],
  dueAt: ["due_date", "duedate", "deadline", "due"],
  closedAt: ["closed_date", "closeddate", "date_closed", "completed_date", "completed", "closed"],
  department: ["department", "dept", "assigned_to", "assigned_department"],
  recordType: ["record_type", "recordtype", "type", "category"],
  releasedRecords: [
    "released_records",
    "released_record_ids",
    "release_records",
    "released_files",
    "released_documents",
  ],
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

// --- status mapping ------------------------------------------------------

const STATUS_SYNONYMS: Record<RequestStatus, string[]> = {
  draft: ["draft"],
  submitted: ["new", "submitted", "received"],
  in_review: ["in_review", "under_review", "reviewing", "triage"],
  clarification_needed: ["clarification_needed", "clarification", "needs_clarification", "pending_requester"],
  in_progress: ["in_progress", "processing", "pending", "working", "assigned", "open"],
  records_review: ["records_review", "review", "staff_review"],
  partially_fulfilled: ["partial", "partially_fulfilled", "partially_completed"],
  fulfilled: ["fulfilled", "complete", "completed", "granted", "closed_fulfilled", "provided"],
  denied: ["denied", "rejected", "refused"],
  referred: ["referred", "referral", "forwarded", "transferred", "wrong_agency"],
  withdrawn: ["withdrawn", "cancelled", "canceled", "abandoned"],
  closed: ["closed", "done", "resolved"],
};

const STATUS_LOOKUP = new Map<string, RequestStatus>();
for (const [status, synonyms] of Object.entries(STATUS_SYNONYMS) as [RequestStatus, string[]][]) {
  for (const s of synonyms) STATUS_LOOKUP.set(s, status);
}

/**
 * Map a free-text legacy status to our enum. Unknown text falls back to
 * "closed" — the safe terminal reading for "no longer needs action" — and
 * `matched: false` so the caller can warn without failing the row; a records
 * office's export is not going to use our exact vocabulary.
 */
export function mapLegacyStatus(raw: string): { status: RequestStatus; matched: boolean } {
  const key = normalizeHeader(raw || "");
  const status = STATUS_LOOKUP.get(key);
  return status ? { status, matched: true } : { status: "closed", matched: false };
}

const TERMINAL_STATUSES: ReadonlySet<RequestStatus> = new Set([
  "fulfilled",
  "denied",
  "withdrawn",
  "closed",
]);

// --- date parsing ----------------------------------------------------------

/** Accepts ISO (2026-03-04) and US slash dates (3/4/2026, 03/04/2026). */
export function parseLegacyDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00Z`); // noon UTC — no day-shift from local tz
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const [, mm, dd, yyyy] = us;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), 12));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// --- row parsing -------------------------------------------------------------

export interface ParsedLegacyRow {
  /** 1-based, matching what a spreadsheet user sees, header row excluded. */
  rowNumber: number;
  legacyId: string | null;
  requesterName: string | null;
  requesterEmail: string | null;
  description: string;
  status: RequestStatus;
  statusMatched: boolean;
  receivedAt: Date;
  dueAt: Date | null;
  closedAt: Date | null;
  department: string | null;
  recordType: string | null;
  /**
   * external_ids of already-imported documents this request RELEASED
   * (release-history import — the join key is the records-import
   * external_id). Empty when the column is absent.
   */
  releasedRecordIds: string[];
  /** Non-fatal issues worth surfacing (e.g. "due date missing"). */
  warnings: string[];
}

export interface LegacyImportRowError {
  rowNumber: number;
  reason: string;
}

export interface LegacyImportParseResult {
  rows: ParsedLegacyRow[];
  errors: LegacyImportRowError[];
  missingHeaders: string[];
}

const REQUIRED_HEADERS = ["description", "receivedAt"] as const;

/** Parse a legacy-system CSV export into import-ready rows. Pure; no I/O. */
export function parseLegacyCsv(csvText: string): LegacyImportParseResult {
  const table = parseCsvTable(csvText.trim());
  if (table.length === 0) return { rows: [], errors: [], missingHeaders: [...REQUIRED_HEADERS] };

  const [headerRow, ...dataRows] = table;
  const index = buildHeaderIndex(headerRow!);
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !index.has(h));

  const get = (row: string[], field: string): string => {
    const i = index.get(field);
    return i != null ? (row[i] ?? "").trim() : "";
  };

  const rows: ParsedLegacyRow[] = [];
  const errors: LegacyImportRowError[] = [];

  dataRows.forEach((row, i) => {
    const rowNumber = i + 1;
    if (row.every((c) => c.trim() === "")) return; // truly blank row — skip silently

    const description = get(row, "description");
    if (!description) {
      errors.push({ rowNumber, reason: "Missing description/scope — nothing to file." });
      return;
    }
    const receivedRaw = get(row, "receivedAt");
    const receivedAt = parseLegacyDate(receivedRaw);
    if (!receivedAt) {
      errors.push({
        rowNumber,
        reason: receivedRaw
          ? `Unrecognized filed date "${receivedRaw}" (use YYYY-MM-DD or MM/DD/YYYY).`
          : "Missing filed/received date.",
      });
      return;
    }

    const warnings: string[] = [];
    const { status, matched } = mapLegacyStatus(get(row, "status"));
    if (!matched) warnings.push(`Unrecognized status "${get(row, "status") || "(blank)"}" — imported as "closed".`);

    let dueAt: Date | null = null;
    const dueRaw = get(row, "dueAt");
    if (dueRaw) {
      dueAt = parseLegacyDate(dueRaw);
      if (!dueAt) warnings.push(`Unrecognized due date "${dueRaw}" — left blank.`);
    }

    let closedAt: Date | null = null;
    const closedRaw = get(row, "closedAt");
    if (closedRaw) {
      closedAt = parseLegacyDate(closedRaw);
      if (!closedAt) warnings.push(`Unrecognized closed date "${closedRaw}" — left blank.`);
    }
    if (TERMINAL_STATUSES.has(status) && !closedAt) {
      warnings.push(`Status "${status}" but no closed date — imported without one (won't count in on-time stats).`);
    }

    const requesterEmail = get(row, "requesterEmail") || null;
    if (requesterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail)) {
      warnings.push(`"${requesterEmail}" doesn't look like an email — imported without a requester account.`);
    }

    // Released records: ; or | separated external_ids, deduped, order kept.
    const releasedRecordIds = [
      ...new Set(
        get(row, "releasedRecords")
          .split(/[;|]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];

    rows.push({
      rowNumber,
      legacyId: get(row, "legacyId") || null,
      requesterName: get(row, "requesterName") || null,
      requesterEmail: requesterEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requesterEmail) ? requesterEmail : null,
      description,
      status,
      statusMatched: matched,
      receivedAt,
      dueAt,
      closedAt,
      department: get(row, "department") || null,
      recordType: get(row, "recordType") || null,
      releasedRecordIds,
      warnings,
    });
  });

  return { rows, errors, missingHeaders };
}

/** The template a records office can fill in — headers this parser recognizes. */
export const LEGACY_CSV_TEMPLATE = [
  "legacy_id,requester_name,requester_email,description,status,filed_date,due_date,closed_date,department,record_type,released_records",
  '"OLD-2024-0091",Jane Reyes,jane@example.com,"All emails re: Main St paving, Jan-Mar 2024",fulfilled,2024-01-15,2024-01-25,2024-01-24,Public Works,contract,"PAV-2024-001;PAV-2024-002"',
].join("\n");
