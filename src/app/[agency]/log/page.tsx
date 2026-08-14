import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getAgencyForSlug } from "@/lib/live";
import { publicLogSummary, toPublicLogEntry } from "@/domain/transparencyLog";

export const dynamic = "force-dynamic";

/**
 * The public request log — every request this office has received, with its
 * outcome and timing, published for anyone to check (opt-in per agency).
 * Requester identities never appear here, and subjects are the staff-curated
 * scope, never the raw filing text (see src/domain/transparencyLog.ts).
 */
export default async function PublicLogPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const agency = await getAgencyForSlug(slug);
  if (!agency || !agency.id) notFound();

  const repo = await getRepository();
  const agencyRow = await repo.getAgency(agency.id);
  if (agencyRow?.settings?.publicRequestLog !== true) notFound(); // opt-in

  const requests = (await repo.listRequests(agency.id)).sort(
    (a, b) => (b.receivedAt ?? b.createdAt).getTime() - (a.receivedAt ?? a.createdAt).getTime(),
  );
  const entries = requests.map(toPublicLogEntry);
  const summary = publicLogSummary(requests);

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "var(--page-top) var(--page-bottom)" }}>
      <span className="eyebrow">{agency.name} · Public Records</span>
      <h1 className="serif" style={{ fontSize: "1.9rem", marginTop: 8, fontWeight: 600 }}>
        Request log
      </h1>
      <p className="muted" style={{ marginTop: 8, maxWidth: 620 }}>
        Every public records request this office has received, updated live. Requester identities
        are not published; subjects reflect the office&apos;s working description of each request.
      </p>

      <div className="stat-row" style={{ marginTop: 20, gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="stat">
          <div className="stat-num">{summary.total}</div>
          <div className="stat-label">Requests received</div>
        </div>
        <div className="stat">
          <div className="stat-num">{summary.open}</div>
          <div className="stat-label">Open now</div>
        </div>
        <div className="stat">
          <div className="stat-num">{summary.onTimeRate == null ? "—" : `${summary.onTimeRate}%`}</div>
          <div className="stat-label">Closed on time</div>
        </div>
        <div className="stat">
          <div className="stat-num">
            {summary.medianDaysToClose == null ? "—" : summary.medianDaysToClose}
          </div>
          <div className="stat-label">Median days to close</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 22, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="queue" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ whiteSpace: "nowrap" }}>Request</th>
                <th>Subject</th>
                <th style={{ whiteSpace: "nowrap" }}>Received</th>
                <th style={{ whiteSpace: "nowrap" }}>Status</th>
                <th style={{ whiteSpace: "nowrap" }}>Closed</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.publicId}>
                  <td className="mono" style={{ whiteSpace: "nowrap", fontSize: "0.82rem" }}>
                    {e.publicId}
                  </td>
                  <td style={{ fontSize: "0.9rem", maxWidth: 420 }}>{e.subject}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                    {e.receivedOn}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <span className="pill">{e.statusLabel}</span>
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.85rem" }}>
                    {e.closedOn ?? "—"}
                    {e.onTime === true && <span title="Closed on time"> ✓</span>}
                    {e.onTime === false && (
                      <span style={{ color: "var(--overdue)" }} title="Closed after the statutory deadline">
                        {" "}
                        late
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: 16 }}>
                    No requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="muted" style={{ fontSize: "0.8rem", marginTop: 14 }}>
        Published under this office&apos;s transparency policy. Released records are in the{" "}
        <a href={`/${agency.slug}/archive`}>public archive</a>.
      </p>
    </div>
  );
}
