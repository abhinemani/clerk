/**
 * CSV export (spec §11: "One-click CSV export"). Pure, RFC-4180-ish quoting.
 */
import type { ComplianceReport } from "./metrics";

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

/**
 * The annual report as one spreadsheet — every figure the PDF narrative
 * carries, in section/metric/value rows so an AG's office can pivot it
 * without parsing prose. Rates are decimals (0–1), not "87%": spreadsheets
 * do their own formatting, and a pre-rendered percent string breaks sums.
 */
export function complianceReportCsv(
  report: ComplianceReport,
  opts: {
    agencyName: string;
    periodLabel: string;
    statuteReview?: { reviewedBy: string; reviewedOn: string } | null;
  },
): string {
  const months = Object.entries(report.volumeByMonth).sort(([a], [b]) => a.localeCompare(b));
  const types = Object.entries(report.volumeByRequesterType).sort(([, a], [, b]) => b - a);
  const rows: Array<Record<string, unknown>> = [
    { section: "report", metric: "agency", value: opts.agencyName },
    { section: "report", metric: "period", value: opts.periodLabel },
    {
      section: "report",
      metric: "statute_reviewed_by_counsel",
      value: opts.statuteReview
        ? `${opts.statuteReview.reviewedBy} on ${opts.statuteReview.reviewedOn}`
        : "not yet reviewed",
    },
    { section: "summary", metric: "total_requests", value: report.total },
    { section: "summary", metric: "closed", value: report.closed },
    { section: "summary", metric: "open", value: report.open },
    { section: "summary", metric: "referred", value: report.referred },
    { section: "summary", metric: "on_time_rate", value: report.onTimeRate.toFixed(3) },
    { section: "summary", metric: "extension_usage_rate", value: report.extensionUsageRate.toFixed(3) },
    { section: "summary", metric: "deflections", value: report.deflections },
    { section: "days_to_close", metric: "median", value: report.daysToClose.median },
    { section: "days_to_close", metric: "p90", value: report.daysToClose.p90 },
    { section: "days_to_close", metric: "mean", value: report.daysToClose.mean },
    { section: "days_to_close", metric: "closed_count", value: report.daysToClose.count },
    ...months.map(([m, c]) => ({ section: "volume_by_month", metric: m, value: c })),
    ...types.map(([t, c]) => ({ section: "volume_by_requester_type", metric: t, value: c })),
    ...report.exemptionFrequency.map((e) => ({ section: "exemptions_cited", metric: e.label, value: e.count })),
  ];
  return toCsv(rows, ["section", "metric", "value"]);
}
