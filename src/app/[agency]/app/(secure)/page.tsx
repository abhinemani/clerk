import Link from "next/link";
import { notFound } from "next/navigation";
import { decisionsFor, getWorkspace, outstandingTasks, workloadFor } from "@/lib/live";
import { deadlineRisk, byRiskDesc, type RiskBand } from "@/domain/deadlineRisk";
import { runDeadlineSweep } from "@/agents/deadlineAgent";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { requireStaff } from "@/auth/guards";
import { portalSignOut } from "../../actions";
import { AiPill, Avatar, DeadlineBand, RiskMeter, StatusPill } from "../../../_components/ui";

// Reads the live database — never prerender a stale queue at build time.
export const dynamic = "force-dynamic";

const BAND_LABEL: Record<RiskBand, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
};

export default async function Queue({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const staff = await requireStaff(slug);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();

  // The deadline agent runs its nightly sweep (pure logic, no model) and hands
  // the coordinator a morning digest (§16.1).
  const sweep = await runDeadlineSweep({
    now: ws.now,
    queue: ws.requests.map((r) => ({
      publicId: r.publicId,
      dueAt: r.dueAt,
      outstandingTasks: outstandingTasks(r),
      complexityScore: r.complexityScore ?? 0, // untriaged → no complexity signal yet
    })),
  });

  const rows = ws.requests
    .map((r) => {
      const risk = deadlineRisk({
        dueAt: r.dueAt,
        now: ws.now,
        outstandingTasks: outstandingTasks(r),
        complexityScore: r.complexityScore ?? 0,
      });
      return { r, risk };
    })
    .sort((a, b) => byRiskDesc(a.risk, b.risk));

  const open = rows.length;
  const overdue = rows.filter((x) => x.risk.band === "overdue").length;
  const decisions = decisionsFor(ws.requests, ws.now);
  const workload = workloadFor(ws.departments, ws.requests);

  return (
    <div className="wrap" style={{ paddingBlock: "36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">{ws.agencyName} · Records oversight</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>Command center</h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Link href={`/${slug}/app/reports`} className="btn btn-sm">
            Compliance report →
          </Link>
          {staff.role === "admin" && (
            <Link href={`/${slug}/app/admin`} className="btn btn-sm">
              Manage staff
            </Link>
          )}
          <span className="muted hide-sm" style={{ fontSize: "0.9rem" }}>
            {staff.name ?? staff.email}
          </span>
          <form action={portalSignOut.bind(null, slug)}>
            <button className="btn btn-sm btn-ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>

      {ws.source === "demo" && (
        <p className="muted" style={{ fontSize: "0.82rem", marginTop: 8 }}>
          Showing sample data — run <span className="mono">npm run seed</span> (or file a request in
          the portal) to switch to the live database.
        </p>
      )}

      {/* Oversight metrics leaders track (§8, §11) */}
      <div className="stat-row" style={{ marginTop: 20, gridTemplateColumns: "repeat(5, 1fr)" }}>
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
          <div className="stat-num" style={{ color: decisions.length ? "var(--due)" : undefined }}>
            {decisions.length}
          </div>
          <div className="stat-label">Need a decision</div>
        </div>
        <div className="stat">
          <div className="stat-num">94%</div>
          <div className="stat-label">On-time rate (90d)</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: "var(--ai)" }}>
            41
          </div>
          <div className="stat-label">Deflections this month</div>
        </div>
      </div>

      {/* Two-up: what needs a leader's decision today + department workload */}
      <div className="cc-grid" style={{ marginTop: 20 }}>
        <div className="card card-pad">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="panel-title">Needs a decision today</div>
            <span className="pill">{decisions.length}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
            {decisions.map(({ request, reason, severity }) => (
              <li key={request.id}>
                <Link
                  href={`/${slug}/app/requests/${request.id}`}
                  style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--ink)" }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flex: "none",
                      background: severity === "high" ? "var(--overdue)" : "var(--due)",
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 550, fontSize: "0.92rem" }}>{reason}</span>
                    <span className="muted mono" style={{ display: "block", fontSize: "0.76rem" }}>
                      {request.publicId} · {request.requesterName}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {decisions.length === 0 && <li className="muted">Nothing needs you right now.</li>}
          </ul>
        </div>

        <div className="card card-pad">
          <div className="panel-title">Department workload</div>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {workload.map((d) => (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={d.lead} tone="primary" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 550, fontSize: "0.9rem" }}>{d.name}</div>
                  <div className="muted" style={{ fontSize: "0.78rem" }}>
                    {d.open} open · {d.done} done
                  </div>
                </div>
                {d.pushedBack > 0 && <span className="pill band-overdue">{d.pushedBack} pushback</span>}
                {d.submitted > 0 && <span className="pill pill-ai">{d.submitted} to review</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ai-card" style={{ marginTop: 20 }}>
        <div className="ai-head">
          <AiPill>Deadline agent</AiPill>
          <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
            nightly sweep · ran {sweep.events.length} steps · {sweep.outcome}
          </span>
        </div>
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.82rem",
            whiteSpace: "pre-wrap",
            margin: 0,
            color: "var(--ink-2)",
          }}
        >
          {sweep.digest}
        </pre>
      </div>

      <h2 style={{ fontSize: "1.15rem", marginTop: 28, marginBottom: 12 }}>
        All requests <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>· by deadline risk</span>
      </h2>

      <div className="card" style={{ overflow: "hidden" }}>
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
                    <Link href={`/${slug}/app/requests/${r.id}`} style={{ fontWeight: 600, color: "var(--ink)" }}>
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
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ padding: 20 }}>
                    No requests yet — file one from the portal and it lands here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        .cc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 820px) { .cc-grid { grid-template-columns: 1fr; }
          .stat-row { grid-template-columns: repeat(2, 1fr) !important; } }
      `}</style>
    </div>
  );
}
