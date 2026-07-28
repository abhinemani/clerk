/**
 * CSV export (spec §11: "One-click CSV export"). Pure, RFC-4180-ish quoting.
 */
function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of objects → CSV. Columns come from `headers` (or the first row's keys). */
export function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [cols.map(cell).join(",")];
  for (const row of rows) lines.push(cols.map((c) => cell(row[c])).join(","));
  return lines.join("\n");
}

/** A key/value metric table as CSV. */
export function metricsCsv(pairs: Array<[string, unknown]>): string {
  return toCsv(pairs.map(([metric, value]) => ({ metric, value })), ["metric", "value"]);
}
