/**
 * Tabular answers (connected-sources phase 3, docs/connected-sources.md) —
 * the pure composition step: given the PUBLIC rows of exactly one dataset
 * and the question's parsed shape, either build a table a resident can
 * check, or return null.
 *
 * REFUSAL-WHEN-UNSURE IS THE DESIGN, not an edge case. A wrong table is
 * confidently wrong — a count over partial rows, or the wrong dataset,
 * reads as an authoritative answer. So every uncertain branch refuses:
 * the archive's ordinary slice results still render, and the resident
 * loses nothing but a shortcut. The rules, each tested:
 *  - No rows in the window → no table.
 *  - The question's leftover terms (after date parsing) must connect to
 *    the data: terms that name the dataset or its columns calibrate; terms
 *    that match cell values filter the rows; a term that matches NOTHING
 *    refuses — the question is probably about something this table
 *    doesn't show.
 *  - Filtering (and its "N matching rows" count) requires the FULL row set
 *    in hand; a partial fetch refuses the filter rather than under-count.
 *  - The unfiltered count is the store's exact total, never the fetched
 *    page's length.
 * Completeness of the row store itself (truncated slices, unmaterialized
 * slices) is the caller's gate — see tabularAnswerService.
 */
import { demandTerms } from "./demandPatterns";

export interface TabularAnswerSourceRow {
  data: Record<string, string>;
  recordDate: string;
  period: string;
}

export interface TabularAnswer {
  dataset: string;
  /** Humanized dataset name ("street-sweeping" → "Street Sweeping"). */
  title: string;
  sourceName: string;
  columns: string[];
  /** Display rows (capped), cells ordered by `columns`. */
  rows: string[][];
  totalRows: number;
  shownRows: number;
  /** Distinct periods among the matched rows, sorted. */
  periods: string[];
  syncedAt: string;
  rangeLabel: string | null;
  /** The term(s) the rows were filtered by, or null for the whole window. */
  filteredBy: string | null;
  /** The checkable sentence — what was counted, from where, how fresh. */
  basis: string;
}

/** Display cap — the card is an answer, not an export. */
export const TABULAR_ANSWER_MAX_ROWS = 40;

/** Time vocabulary the date parser may leave behind ("in june 2026" parses
 *  the year and strands "june"). Calendar words describe WHEN, never WHAT —
 *  they must not become row filters and refuse an otherwise clean answer. */
const CALENDAR_TERMS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "day", "days", "week", "weeks", "month", "months", "year", "years",
  "today", "yesterday", "recent", "recently", "latest", "current",
]);

export function humanizeDataset(dataset: string): string {
  return dataset.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function composeTabularAnswer(input: {
  dataset: string;
  sourceName: string;
  /** Latest sync stamp among the dataset's public slices (ISO). */
  syncedAt: string;
  /** Column order from the slice stamp; empty ⇒ derived from the rows. */
  columns: string[];
  /** Range-filtered PUBLIC rows, recordDate asc — possibly a partial page. */
  rows: TabularAnswerSourceRow[];
  /** Exact total matches in the window (from the store, not the page). */
  totalRows: number;
  rangeLabel: string | null;
  /** The question minus its date words — what's left must connect to the data. */
  residualQuery: string;
}): TabularAnswer | null {
  if (input.rows.length === 0 || input.totalRows === 0) return null;

  const columns =
    input.columns.length > 0
      ? input.columns
      : [...new Set(input.rows.flatMap((r) => Object.keys(r.data)))];
  if (columns.length === 0) return null;

  const title = humanizeDataset(input.dataset);

  // Split the residual terms: naming terms (dataset title, source name,
  // column names) justify the table choice; anything else must match cell
  // values and becomes a row filter.
  const namingTerms = new Set([
    ...demandTerms(`${title} ${input.dataset.replace(/[-_]+/g, " ")}`),
    ...demandTerms(input.sourceName),
    ...demandTerms(columns.join(" ")),
  ]);
  const residualTerms = [...demandTerms(input.residualQuery)].filter((t) => !CALENDAR_TERMS.has(t));

  // Sort every non-calendar question term into connected (it names the data
  // or appears in it) vs unconnected (the data can't account for it). One
  // stray synonym ("cleanings" against a sweeping log the search already
  // matched) must not refuse a clearly-labeled answer — but when the
  // UNCONNECTED terms outnumber the connected ones, the question is
  // probably about something this table doesn't show. Refuse.
  const cellMatch = (t: string) =>
    input.rows.some((r) => Object.values(r.data).join(" ").toLowerCase().includes(t));
  const cellTerms: string[] = [];
  let connectedCount = 0;
  let unconnectedCount = 0;
  for (const t of residualTerms) {
    if (namingTerms.has(t)) {
      connectedCount++;
    } else if (cellMatch(t)) {
      connectedCount++;
      cellTerms.push(t);
    } else {
      unconnectedCount++;
    }
  }
  if (residualTerms.length > 0 && (connectedCount === 0 || unconnectedCount > connectedCount)) {
    return null;
  }

  let matched = input.rows;
  let filteredBy: string | null = null;
  let total = input.totalRows;
  if (cellTerms.length > 0) {
    // Filtering needs every row in hand — a filtered count over a partial
    // page would silently under-count. Refuse instead.
    if (input.rows.length < input.totalRows) return null;
    matched = input.rows.filter((r) => {
      const haystack = Object.values(r.data).join(" ").toLowerCase();
      return cellTerms.every((t) => haystack.includes(t));
    });
    if (matched.length === 0) return null; // the data doesn't show this combination
    filteredBy = cellTerms.join(" ");
    total = matched.length;
  }

  const shown = matched.slice(0, TABULAR_ANSWER_MAX_ROWS);
  const periods = [...new Set(matched.map((r) => r.period))].sort();

  // A partial page can't see every contributing slice — the row count is
  // still exact (it comes from the store), but the slice claim isn't made.
  const partial = input.rows.length < input.totalRows;
  const basis = [
    `${total} row${total === 1 ? "" : "s"} of "${title}" (${input.sourceName})`,
    input.rangeLabel ? `within ${input.rangeLabel}` : null,
    filteredBy ? `matching "${filteredBy}"` : null,
    partial
      ? `— counted in the published archive, synced ${input.syncedAt.slice(0, 10)}`
      : `— counted from ${periods.length} published slice${periods.length === 1 ? "" : "s"}, synced ${input.syncedAt.slice(0, 10)}`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    dataset: input.dataset,
    title,
    sourceName: input.sourceName,
    columns,
    rows: shown.map((r) => columns.map((c) => r.data[c] ?? "")),
    totalRows: total,
    shownRows: shown.length,
    periods,
    syncedAt: input.syncedAt,
    rangeLabel: input.rangeLabel,
    filteredBy,
    basis,
  };
}
