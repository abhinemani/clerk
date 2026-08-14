import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { liveComplianceDataset } from "@/lib/reportingData";
import { transparencyImpact, type TransparencyImpact } from "@/services/transparencyImpactService";
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

  // The north-star section (docs/transparency-impact.md) — live agencies
  // only; the unseeded demo fixture has no deflection/publication history.
  let impact: TransparencyImpact | null = null;
  if (agency.id) {
    impact = await transparencyImpact(await getRepository(), agency.id, new Date());
  }
  const maxImpact = impact
    ? Math.max(...impact.monthly.map((m) => Math.max(m.requests, m.deflections)), 1)
    : 1;

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
    <div className="wrap" style={{ paddingBlock: "var(--page-top) var(--page-bottom)" }}>
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
          {report.exemptionFrequency.length === 0 && (
            <p className="muted" style={{ margin: 0, fontSize: "0.9rem" }}>
              No exemptions cited yet — every release so far has gone out unredacted and
              unwithheld. Citations appear here as review decisions record them.
            </p>
          )}
        </div>
      </div>

      {impact && (
        <>
          <h2 style={{ fontSize: "1.1rem", marginTop: 30, marginBottom: 8 }}>
            Transparency impact
          </h2>
          <p className="muted" style={{ fontSize: "0.9rem", marginBottom: 12, maxWidth: 620 }}>
            The number this platform exists to move: requests that never needed filing, because
            the records were already public. Archive misses never count as savings — they are
            unmet demand.
          </p>

          <div className="stat-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
            <div className="stat">
              <div className="stat-num" style={{ color: "var(--ai)" }}>{impact.totals.hoursAvoidedAllTime}</div>
              <div className="stat-label">Staff-hours avoided, all time</div>
            </div>
            <div className="stat">
              <div className="stat-num">{impact.totals.deflectionsAllTime}</div>
              <div className="stat-label">Requests deflected</div>
            </div>
            <div className="stat">
              <div className="stat-num">{impact.totals.publishedRecords}</div>
              <div className="stat-label">Records in the public archive</div>
            </div>
          </div>

          <div className="card card-pad" style={{ marginTop: 16 }}>
            <div className="panel-title">Requests vs. deflections, last 6 months</div>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              {impact.monthly.map((m) => (
                // flexWrap + minWidth on the bars: at phone width the count
                // line drops below the bars instead of crushing them.
                <div key={m.month} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="mono muted" style={{ fontSize: "0.8rem", width: 58 }}>{m.month}</span>
                  <div style={{ flex: 1, minWidth: 160, display: "grid", gap: 3 }}>
                    <div style={{ background: "var(--surface-3)", borderRadius: "var(--r-pill)", height: 8 }}>
                      <div style={{ width: `${(m.requests / maxImpact) * 100}%`, height: "100%", background: "var(--primary)", borderRadius: "var(--r-pill)" }} />
                    </div>
                    <div style={{ background: "var(--surface-3)", borderRadius: "var(--r-pill)", height: 8 }}>
                      <div style={{ width: `${(m.deflections / maxImpact) * 100}%`, height: "100%", background: "var(--ai)", borderRadius: "var(--r-pill)" }} />
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: "0.78rem", marginLeft: "auto", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {m.requests} filed · {m.deflections} deflected
                    {m.recordsPublished > 0 ? ` · ${m.recordsPublished} published` : ""}
                    {m.archiveMisses > 0 ? ` · ${m.archiveMisses} misses` : ""}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
              Top bar: requests filed. Bottom bar: requests deflected (answered by the archive
              instead). The goal is the bottom bar growing at the top bar&apos;s expense.
            </p>
          </div>

          {impact.opportunities.length > 0 && (
            <div className="card card-pad" style={{ marginTop: 16 }}>
              <div className="panel-title">What publishing next would be worth</div>
              <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 12 }}>
                {impact.opportunities.map((o, i) => (
                  <li key={i} style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600 }}>{o.topic}</span>
                      <span className="pill" style={{ color: "var(--ai)" }}>≈ {o.projectedHours}h / quarter</span>
                      <Link
                        href={`/${slug}/app/search?q=${encodeURIComponent(o.keywords.join(" "))}`}
                        className="btn btn-sm"
                      >
                        Find the records
                      </Link>
                    </div>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>{o.basis}</span>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: 10 }}>
                Projections are deliberately conservative (citation-answer rate, not full
                productions) and every number traces to the request log. Publishing any record
                is a named human&apos;s call, made per record.
              </p>
            </div>
          )}
        </>
      )}

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
