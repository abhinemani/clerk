/**
 * Annual compliance report — the narrative artifact counsel actually asks
 * for (roadmap: "ship the artifacts, not just the on-screen numbers"). Pure
 * rendering of the same §11 ComplianceReport the on-screen dashboard and CSV
 * export already compute; a caller turns this text into a PDF
 * (renderTextPdf) exactly like the per-request defensibility report.
 */
import type { ComplianceReport } from "./metrics";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function renderComplianceNarrative(
  report: ComplianceReport,
  agencyName: string,
  periodLabel: string,
  opts?: {
    /** Counsel sign-off on the statute configuration — printed so the report
     *  is honest about whether its deadline math was ever legally reviewed. */
    statuteReview?: { reviewedBy: string; reviewedOn: string } | null;
  },
): string {
  const title = `${agencyName} — Public Records Compliance Report`;
  const months = Object.entries(report.volumeByMonth).sort(([a], [b]) => a.localeCompare(b));
  const types = Object.entries(report.volumeByRequesterType).sort(([, a], [, b]) => b - a);

  const lines = [
    title,
    "=".repeat(title.length),
    `Period: ${periodLabel}`,
    opts?.statuteReview
      ? `Statute configuration reviewed by counsel: ${opts.statuteReview.reviewedBy}, ${opts.statuteReview.reviewedOn}`
      : "Statute configuration not yet reviewed by counsel.",
    "",
    "Summary",
    "-------",
    `  Total requests:        ${report.total}`,
    `  Closed:                ${report.closed}`,
    `  Still open:            ${report.open}`,
    `  On-time rate:          ${pct(report.onTimeRate)} (of closed requests, met statutory deadline)`,
    `  Statutory extensions:  ${pct(report.extensionUsageRate)} of requests used one`,
    `  Referred elsewhere:    ${report.referred} (records held by another agency — not denials)`,
    `  Deflections:           ${report.deflections} (answered from the public archive, no request filed)`,
    "",
    "Days to close (closed requests)",
    "--------------------------------",
    report.daysToClose.count > 0
      ? `  Median: ${report.daysToClose.median}  ·  90th percentile: ${report.daysToClose.p90}  ·  Mean: ${report.daysToClose.mean}  (n=${report.daysToClose.count})`
      : "  No closed requests in this period.",
    "",
    "Volume by month (received)",
    "---------------------------",
    ...(months.length > 0
      ? months.map(([m, c]) => `  ${m}: ${c}`)
      : ["  No requests in this period."]),
    "",
    "Volume by requester type",
    "-------------------------",
    ...(types.length > 0
      ? types.map(([t, c]) => `  ${t}: ${c}`)
      : ["  No requests in this period."]),
    "",
    "Exemptions cited",
    "-----------------",
    ...(report.exemptionFrequency.length > 0
      ? report.exemptionFrequency.map((e) => `  ${e.label}: ${e.count}`)
      : ["  None cited in this period."]),
    "",
    "This report is computed from the live request record — the same figures",
    "shown in the workspace and exportable as CSV. Per-request audit trails",
    "(the defensibility report) are available from each request's detail page.",
  ];
  return lines.join("\n");
}
