/**
 * Compliance reporting metrics (spec §11).
 *
 * "Agencies live and die by their annual compliance reports." Pure aggregation
 * over request records — no I/O — so it's fully testable and runs on either the
 * demo data or the live repository.
 */
const MS_DAY = 86_400_000;

export interface RequestForMetrics {
  receivedAt: Date;
  /** When the request reached a terminal outcome (fulfilled/denied/closed). */
  closedAt?: Date | null;
  statutoryDueAt?: Date | null;
  status: string;
  requesterType: string;
  department?: string | null;
  /** Whether a statutory extension was used. */
  extended: boolean;
  /** Exemption short-labels cited on the response, if any. */
  exemptionsCited: string[];
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_DAY);
}

/** Linear-interpolated percentile (p in [0,1]). Empty → 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

const closed = (r: RequestForMetrics) => r.closedAt != null;

/** Share of closed requests met on or before the statutory deadline. */
export function onTimeRate(records: RequestForMetrics[]): number {
  const done = records.filter((r) => closed(r) && r.statutoryDueAt);
  if (done.length === 0) return 1;
  const onTime = done.filter((r) => r.closedAt! <= r.statutoryDueAt!).length;
  return onTime / done.length;
}

export interface DaysToClose {
  median: number;
  p90: number;
  mean: number;
  count: number;
}

export function daysToClose(records: RequestForMetrics[]): DaysToClose {
  const spans = records.filter(closed).map((r) => daysBetween(r.receivedAt, r.closedAt!));
  if (spans.length === 0) return { median: 0, p90: 0, mean: 0, count: 0 };
  const mean = spans.reduce((a, b) => a + b, 0) / spans.length;
  return {
    median: Math.round(percentile(spans, 0.5)),
    p90: Math.round(percentile(spans, 0.9)),
    mean: Math.round(mean),
    count: spans.length,
  };
}

/** YYYY-MM → count, keyed on receivedAt. */
export function volumeByMonth(records: RequestForMetrics[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    const m = `${r.receivedAt.getUTCFullYear()}-${String(r.receivedAt.getUTCMonth() + 1).padStart(2, "0")}`;
    out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}

export function countBy<T extends string>(records: RequestForMetrics[], key: (r: RequestForMetrics) => T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export const volumeByRequesterType = (records: RequestForMetrics[]) =>
  countBy(records, (r) => r.requesterType);

/** Share of requests that used a statutory extension. */
export function extensionUsageRate(records: RequestForMetrics[]): number {
  if (records.length === 0) return 0;
  return records.filter((r) => r.extended).length / records.length;
}

/** Exemption citation frequency across all responses, most-cited first. */
export function exemptionFrequency(records: RequestForMetrics[]): Array<{ label: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const r of records) for (const ex of r.exemptionsCited) counts[ex] = (counts[ex] ?? 0) + 1;
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

export interface ComplianceReport {
  total: number;
  closed: number;
  open: number;
  /** Wrong-custodian outcomes. Reported apart from denials on purpose: a
   *  referral means we didn't hold the records, not that we withheld them. */
  referred: number;
  onTimeRate: number;
  daysToClose: DaysToClose;
  extensionUsageRate: number;
  volumeByMonth: Record<string, number>;
  volumeByRequesterType: Record<string, number>;
  exemptionFrequency: Array<{ label: string; count: number }>;
  deflections: number;
}

/** Assemble the full annual-report metric set (§11). */
export function complianceReport(
  records: RequestForMetrics[],
  deflections = 0,
): ComplianceReport {
  return {
    total: records.length,
    closed: records.filter(closed).length,
    open: records.filter((r) => !closed(r)).length,
    referred: records.filter((r) => r.status === "referred").length,
    onTimeRate: onTimeRate(records),
    daysToClose: daysToClose(records),
    extensionUsageRate: extensionUsageRate(records),
    volumeByMonth: volumeByMonth(records),
    volumeByRequesterType: volumeByRequesterType(records),
    exemptionFrequency: exemptionFrequency(records),
    deflections,
  };
}
