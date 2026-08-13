import Link from "next/link";
import { notFound } from "next/navigation";
import { getAgencyForSlug } from "@/lib/live";
import { liveComplianceDataset } from "@/lib/reportingData";
import { DEFLECTIONS_YTD, reportingDataset } from "@/lib/reportingDemo";
import { complianceReport } from "@/reporting/metrics";
import { complianceReportCsv } from "@/reporting/csv";
import { DownloadButton } from "../../../../_components/DownloadButton";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default async function ReportsPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency) notFound();

  const report = agency.id
    ? await liveComplianceDataset(agency.id).then(({ records, deflections }) => complianceReport(records, deflections))
    : complianceReport(reportingDataset(), DEFLECTIONS_YTD);

  const months = Object.entries(report.volumeByMonth).sort(([a], [b]) => a.localeCompare(b));
  const maxMonth = Math.max(...months.map(([, c]) => c), 1);
  const types = Object.entries(report.volumeByRequesterType).sort(([, a], [, b]) => b - a);
  const maxType = Math.max(...types.map(([, c]) => c), 1);

  // Demo fixture only — live agencies download from the annual-report.csv
  // route so the artifact always reflects the database at click time.
  const demoCsv = agency.id
    ? null
    : complianceReportCsv(report, { agencyName: agency.name, periodLabel: "2026 YTD" });

  return (
    <div className="wrap" style={{ paddingBlock: "36px" }}>
      <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Command center
      </Link>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <div>
          <span className="eyebrow">{agency.name} · Public Records Act</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>Compliance report · 2026</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {agency.id ? (
            <a href={`/${slug}/app/reports/annual-report.csv`} className="btn btn-sm">
              Download CSV
            </a>
          ) : (
            demoCsv && <DownloadButton filename="brandeis-compliance-2026.csv" content={demoCsv} label="Download CSV" />
          )}
          {agency.id && (
            <a href={`/${slug}/app/reports/annual-report.pdf`} className="btn btn-sm">
              Download PDF
            </a>
          )}
        </div>
      </div>

      <div className="stat-row" style={{ marginTop: 20, gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat">
          <div className="stat-num" style={{ color: report.onTimeRate >= 0.9 ? "var(--ok)" : "var(--due)" }}>
            {pct(report.onTimeRate)}
          </div>
          <div className="stat-label">On-time rate</div>
        </div>
        <div className="stat">
          <div className="stat-num">{report.daysToClose.median}</div>
          <div className="stat-label">Median days to close</div>
        </div>
        <div className="stat">
          <div className="stat-num">{report.daysToClose.p90}</div>
          <div className="stat-label">p90 days to close</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: "var(--ai)" }}>
            {report.deflections}
          </div>
          <div className="stat-label">Deflections (records self-served)</div>
        </div>
      </div>

      <div className="rep-grid" style={{ marginTop: 20 }}>
        <div className="card card-pad">
          <div className="panel-title">Request volume by month</div>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {months.map(([m, c]) => (
              <div key={m} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="mono muted" style={{ fontSize: "0.8rem", width: 58 }}>
                  {m}
                </span>
                <div style={{ flex: 1, background: "var(--surface-3)", borderRadius: "var(--r-pill)", height: 10 }}>
                  <div style={{ width: `${(c / maxMonth) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: "var(--r-pill)" }} />
                </div>
                <span style={{ fontSize: "0.85rem", width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-pad">
          <div className="panel-title">By requester type</div>
          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {types.map(([t, c]) => (
              <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="muted" style={{ fontSize: "0.82rem", width: 90, textTransform: "capitalize" }}>
                  {t}
                </span>
                <div style={{ flex: 1, background: "var(--surface-3)", borderRadius: "var(--r-pill)", height: 10 }}>
                  <div style={{ width: `${(c / maxType) * 100}%`, height: "100%", background: "var(--ai)", borderRadius: "var(--r-pill)" }} />
                </div>
                <span style={{ fontSize: "0.85rem", width: 24, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="panel-title">Most-cited exemptions</div>
          <span className="muted" style={{ fontSize: "0.82rem" }}>
            Extension usage {pct(report.extensionUsageRate)} · {report.closed}/{report.total} closed
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {report.exemptionFrequency.map((e) => (
            <span key={e.label} className="pill">
              {e.label} · {e.count}
            </span>
          ))}
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.82rem", marginTop: 18 }}>
        Maps to the state&apos;s mandated annual FOIA report. Printable summary + per-request
        defensibility export available on each request.
      </p>

      <style>{`
        .rep-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 820px) { .rep-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
