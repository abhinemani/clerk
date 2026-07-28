import Link from "next/link";
import { DEMO_AGENCY, DEMO_NOW, DEMO_REQUESTS } from "@/lib/demo";
import { deadlineRisk, byRiskDesc, type RiskBand } from "@/domain/deadlineRisk";
import { isTaskTerminal } from "@/domain/taskWorkflow";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { AiPill, Avatar, DeadlineBand, RiskMeter, StatusPill } from "../_components/ui";

const BAND_LABEL: Record<RiskBand, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
};

export default function Queue() {
  const rows = DEMO_REQUESTS.map((r) => {
    const outstandingTasks = r.tasks.filter((t) => !isTaskTerminal(t.status)).length;
    const risk = deadlineRisk({
      dueAt: r.dueAt,
      now: DEMO_NOW,
      outstandingTasks,
      complexityScore: r.complexityScore,
    });
    return { r, risk };
  }).sort((a, b) => byRiskDesc(a.risk, b.risk));

  const open = rows.length;
  const overdue = rows.filter((x) => x.risk.band === "overdue").length;
  const needsReview = DEMO_REQUESTS.filter((r) => r.triageReady).length;

  return (
    <div className="wrap" style={{ paddingBlock: "36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">{DEMO_AGENCY.name} · Records Coordinator</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>Request queue</h1>
        </div>
        <span className="muted" style={{ fontSize: "0.9rem" }}>
          Sorted by deadline risk
        </span>
      </div>

      <div className="stat-row" style={{ marginTop: 20 }}>
        <div className="stat">
          <div className="stat-num">{open}</div>
          <div className="stat-label">Open requests</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: overdue ? "var(--overdue)" : undefined }}>
            {overdue}
          </div>
          <div className="stat-label">Overdue</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: "var(--ai)" }}>
            {needsReview}
          </div>
          <div className="stat-label">AI triage — needs review</div>
        </div>
        <div className="stat">
          <div className="stat-num">94%</div>
          <div className="stat-label">On-time rate (90d)</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="queue">
            <thead>
              <tr>
                <th style={{ width: 120 }}>Deadline</th>
                <th>Request</th>
                <th className="hide-sm">Requester</th>
                <th className="hide-sm">Status</th>
                <th style={{ width: 90 }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, risk }) => (
                <tr key={r.id}>
                  <td>
                    <DeadlineBand band={risk.band} label={BAND_LABEL[risk.band]} />
                    <div className="muted" style={{ fontSize: "0.8rem", marginTop: 5 }}>
                      {dateShort(r.dueAt)} · {daysLabel(risk.daysRemaining)}
                    </div>
                  </td>
                  <td>
                    <Link href={`/app/requests/${r.id}`} style={{ fontWeight: 600, color: "var(--ink)" }}>
                      {r.interpretedScope}
                    </Link>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="mono muted">{r.publicId}</span>
                      {r.triageReady && <AiPill>Triage ready</AiPill>}
                      {r.redFlags.map((f) => (
                        <span key={f} className="pill band-overdue" title="Statutory red flag">
                          {titleCase(f)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="hide-sm">
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <Avatar name={r.requesterName} />
                      <div>
                        <div style={{ fontSize: "0.9rem", fontWeight: 500 }}>{r.requesterName}</div>
                        <div className="muted" style={{ fontSize: "0.78rem" }}>
                          {titleCase(r.requesterType)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="hide-sm">
                    <StatusPill label={requestStatusLabel(r.status)} />
                  </td>
                  <td>
                    <RiskMeter score={risk.score} band={risk.band} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
