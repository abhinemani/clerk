/**
 * Executive report summary — period-windowed metrics for the report a clerk
 * hands to a city manager or council (docs/executive-reporting.md).
 *
 * Pure aggregation, computeDueDate idiom throughout: no I/O, no clock reads —
 * the reference date arrives as an argument, and every section carries a
 * `basis` string that states its own arithmetic so a reader can trace any
 * number back to the request log.
 *
 * Deadline semantics: `statutoryDueAt` on a request is the EFFECTIVE deadline —
 * taking a statutory extension rewrites it (requestService.extendDeadline),
 * with the pre-extension date preserved in the audit trail. So "on time" here
 * means "closed by the deadline including any lawful extension", the same
 * definition the annual compliance report ships.
 */

const MS_DAY = 86_400_000;

export type ReportPeriodKind = "day" | "week" | "month";

/**
 * The composable section catalog — the report builder UI and the PDF renderer
 * share this list (it lives here rather than in executiveReportPdf.ts so the
 * client bundle never imports the Buffer-using PDF engine).
 */
export const EXECUTIVE_SECTIONS = [
  { id: "kpis", label: "Headline numbers" },
  { id: "trend", label: "Volume trend" },
  { id: "deadlines", label: "Deadline performance" },
  { id: "outcomes", label: "Outcomes & exemptions" },
  { id: "departments", label: "Department activity" },
  { id: "impact", label: "Transparency impact" },
] as const;
export type ExecutiveSectionId = (typeof EXECUTIVE_SECTIONS)[number]["id"];
export const ALL_SECTION_IDS: readonly ExecutiveSectionId[] = EXECUTIVE_SECTIONS.map((s) => s.id);

/** Half-open UTC window [start, end). */
export interface ReportPeriod {
  kind: ReportPeriodKind;
  start: Date;
  end: Date;
  label: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function fmtDay(d: Date): string {
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Snap any date inside the window to the enclosing day / ISO week / month. */
export function reportPeriod(kind: ReportPeriodKind, ref: Date): ReportPeriod {
  const day = utcFloor(ref);
  if (kind === "day") {
    return { kind, start: day, end: new Date(day.getTime() + MS_DAY), label: fmtDay(day) };
  }
  if (kind === "week") {
    const back = (day.getUTCDay() + 6) % 7; // Monday-start week
    const start = new Date(day.getTime() - back * MS_DAY);
    const end = new Date(start.getTime() + 7 * MS_DAY);
    const last = new Date(end.getTime() - MS_DAY);
    return { kind, start, end, label: `Week of ${fmtDay(start)}–${fmtDay(last)}` };
  }
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));
  return { kind, start, end, label: `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}` };
}

export function priorPeriod(p: ReportPeriod): ReportPeriod {
  if (p.kind === "month") {
    return reportPeriod("month", new Date(Date.UTC(p.start.getUTCFullYear(), p.start.getUTCMonth() - 1, 1)));
  }
  return reportPeriod(p.kind, new Date(p.start.getTime() - MS_DAY));
}

/** N consecutive periods ending with the one containing `ref` (oldest first). */
export function trailingPeriods(kind: ReportPeriodKind, ref: Date, n: number): ReportPeriod[] {
  const out: ReportPeriod[] = [reportPeriod(kind, ref)];
  while (out.length < n) out.unshift(priorPeriod(out[0]!));
  return out;
}

// --- inputs (projections the loader builds from repository entities) --------

export interface RequestForExecutive {
  publicId: string;
  receivedAt: Date;
  closedAt: Date | null;
  status: string;
  /** Effective deadline — includes any lawful extension (see header comment). */
  statutoryDueAt: Date | null;
  /** When each statutory extension was taken (from extensionHistory). */
  extensionDates: Date[];
  referredAt: Date | null;
  /** Exemption short-labels cited on the response (deduped per request). */
  exemptionsCited: string[];
}

export interface TaskForExecutive {
  departmentName: string | null;
  createdAt: Date | null;
  status: string;
}

export interface DeflectionForExecutive {
  kind: string;
  createdAt: Date;
  hoursAvoided: number;
}

export interface ExecutiveDataset {
  requests: RequestForExecutive[];
  tasks: TaskForExecutive[];
  deflections: DeflectionForExecutive[];
}

// --- output ----------------------------------------------------------------

export interface ExecutiveKpis {
  received: number;
  closed: number;
  backlogAtEnd: number;
  overdueAtEnd: number;
  /** Share of closed-in-period requests that met their deadline; null when nothing closed. */
  onTimeRate: number | null;
  medianDaysToClose: number | null;
}

export interface TrendBucket {
  label: string;
  received: number;
  closed: number;
}

export interface ExecutiveSummary {
  period: ReportPeriod;
  prior: ReportPeriod;
  kpis: { current: ExecutiveKpis; prior: ExecutiveKpis; basis: string };
  trend: { buckets: TrendBucket[]; basis: string };
  deadlines: {
    closedOnTime: number;
    closedLate: number;
    medianDaysToClose: number | null;
    p90DaysToClose: number | null;
    extensionsTaken: number;
    basis: string;
  };
  outcomes: {
    byStatus: Array<{ status: string; count: number }>;
    referred: number;
    exemptions: Array<{ label: string; count: number }>;
    basis: string;
  };
  departments: {
    rows: Array<{ name: string; dispatched: number; done: number; outstanding: number }>;
    basis: string;
  };
  impact: {
    deflections: number;
    hoursAvoided: number;
    archiveMisses: number;
    basis: string;
  };
}

const within = (d: Date | null | undefined, p: ReportPeriod): boolean =>
  d != null && d >= p.start && d < p.end;

function percentileOf(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function kpisFor(requests: RequestForExecutive[], p: ReportPeriod): ExecutiveKpis {
  const received = requests.filter((r) => within(r.receivedAt, p)).length;
  const closedInPeriod = requests.filter((r) => within(r.closedAt, p));
  // Backlog at period end: on the books before the window closed, not yet closed then.
  const backlog = requests.filter(
    (r) => r.receivedAt < p.end && (r.closedAt == null || r.closedAt >= p.end),
  );
  const overdue = backlog.filter((r) => r.statutoryDueAt != null && r.statutoryDueAt < p.end);
  const withDeadline = closedInPeriod.filter((r) => r.statutoryDueAt != null);
  const spans = closedInPeriod.map((r) => Math.round((r.closedAt!.getTime() - r.receivedAt.getTime()) / MS_DAY));
  return {
    received,
    closed: closedInPeriod.length,
    backlogAtEnd: backlog.length,
    overdueAtEnd: overdue.length,
    onTimeRate:
      withDeadline.length === 0
        ? null
        : withDeadline.filter((r) => r.closedAt! <= r.statutoryDueAt!).length / withDeadline.length,
    medianDaysToClose: spans.length === 0 ? null : Math.round(percentileOf(spans, 0.5)),
  };
}

const TREND_BUCKETS: Record<ReportPeriodKind, number> = { day: 14, week: 8, month: 6 };

function trendLabel(p: ReportPeriod): string {
  if (p.kind === "month") return `${MONTHS_SHORT[p.start.getUTCMonth()]} ${String(p.start.getUTCFullYear()).slice(2)}`;
  return `${p.start.getUTCMonth() + 1}/${String(p.start.getUTCDate()).padStart(2, "0")}`;
}

/** Assemble the full summary for the period containing `ref`. Pure. */
export function computeExecutiveSummary(dataset: ExecutiveDataset, kind: ReportPeriodKind, ref: Date): ExecutiveSummary {
  const period = reportPeriod(kind, ref);
  const prior = priorPeriod(period);
  const { requests, tasks, deflections } = dataset;

  const current = kpisFor(requests, period);
  const priorKpis = kpisFor(requests, prior);

  const buckets = trailingPeriods(kind, ref, TREND_BUCKETS[kind]).map((p) => ({
    label: trendLabel(p),
    received: requests.filter((r) => within(r.receivedAt, p)).length,
    closed: requests.filter((r) => within(r.closedAt, p)).length,
  }));

  const closedInPeriod = requests.filter((r) => within(r.closedAt, period));
  const withDeadline = closedInPeriod.filter((r) => r.statutoryDueAt != null);
  const onTime = withDeadline.filter((r) => r.closedAt! <= r.statutoryDueAt!).length;
  const spans = closedInPeriod.map((r) => Math.round((r.closedAt!.getTime() - r.receivedAt.getTime()) / MS_DAY));
  const extensionsTaken = requests.reduce(
    (n, r) => n + r.extensionDates.filter((d) => within(d, period)).length,
    0,
  );

  const byStatus = new Map<string, number>();
  for (const r of closedInPeriod) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const referred = requests.filter((r) => within(r.referredAt, period)).length;
  const exemptionCounts = new Map<string, number>();
  for (const r of closedInPeriod) for (const label of r.exemptionsCited) exemptionCounts.set(label, (exemptionCounts.get(label) ?? 0) + 1);

  // Department activity is the COHORT of tasks dispatched inside the window,
  // followed to their current state — task completion isn't separately
  // timestamped, and the honest alternative to guessing is saying so.
  const deptRows = new Map<string, { dispatched: number; done: number; outstanding: number }>();
  for (const t of tasks) {
    if (t.createdAt == null || !within(t.createdAt, period)) continue;
    const name = t.departmentName ?? "Unassigned";
    const row = deptRows.get(name) ?? { dispatched: 0, done: 0, outstanding: 0 };
    row.dispatched += 1;
    if (t.status === "done") row.done += 1;
    else if (t.status !== "cancelled") row.outstanding += 1;
    deptRows.set(name, row);
  }

  // House rule (enforced everywhere deflections are monetized): archive_miss
  // rows are unmet demand, never ROI — they are counted apart and never
  // contribute to deflections or hours avoided.
  const inPeriodDeflections = deflections.filter((d) => within(d.createdAt, period));
  const realDeflections = inPeriodDeflections.filter((d) => d.kind !== "archive_miss");
  const hoursAvoided = Math.round(realDeflections.reduce((n, d) => n + d.hoursAvoided, 0) * 10) / 10;

  return {
    period,
    prior,
    kpis: {
      current,
      prior: priorKpis,
      basis:
        `Received counts requests whose clock started in ${period.label}; closed counts terminal outcomes in the same window. ` +
        `Backlog and overdue are measured at the window's end. On-time means closed by the statutory deadline including any lawful extension. ` +
        `Prior column: ${prior.label}.`,
    },
    trend: {
      buckets,
      basis: `Requests received and closed per ${kind}, most recent ${buckets.length} ${kind}s, ending with this report's period.`,
    },
    deadlines: {
      closedOnTime: onTime,
      closedLate: withDeadline.length - onTime,
      medianDaysToClose: spans.length === 0 ? null : Math.round(percentileOf(spans, 0.5)),
      p90DaysToClose: spans.length === 0 ? null : Math.round(percentileOf(spans, 0.9)),
      extensionsTaken,
      basis:
        `Of ${withDeadline.length} request${withDeadline.length === 1 ? "" : "s"} closed in the period with a computed deadline. ` +
        `Days to close run from receipt to closure. Extensions are counted by the date they were taken.`,
    },
    outcomes: {
      byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      referred,
      exemptions: [...exemptionCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
      basis:
        "Closures by outcome. Referrals are records held by another agency — counted apart from denials on purpose. " +
        "Exemptions count the requests closed this period that cited them, not documents.",
    },
    departments: {
      rows: [...deptRows.entries()]
        .map(([name, row]) => ({ name, ...row }))
        .sort((a, b) => b.dispatched - a.dispatched),
      basis:
        "Tasks dispatched to each department during the period, followed to their current state. " +
        "Task completion is not separately timestamped, so 'done' reflects status at generation time.",
    },
    impact: {
      deflections: realDeflections.length,
      hoursAvoided,
      archiveMisses: inPeriodDeflections.length - realDeflections.length,
      basis:
        "Requests answered from the public archive instead of being filed, with conservative staff-hour estimates. " +
        "Archive misses (searched, found nothing, filed anyway) are unmet demand and are never counted as savings.",
    },
  };
}
