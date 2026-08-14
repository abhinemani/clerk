import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { decisionsFor, getWorkspace, outstandingTasks, workloadFor } from "@/lib/live";
import { deadlineRisk, byRiskDesc } from "@/domain/deadlineRisk";
import { documentsAtRetentionRisk, type RetentionStatus } from "@/domain/retention";
import { mineDemandPatterns, type DemandPattern } from "@/domain/demandPatterns";
import { demandSignalsFrom } from "@/domain/transparencyImpact";
import { isAssignableRole } from "@/domain/workflow";
import { matchesQueueFilters, parseQueueFilters, hasActiveFilters } from "@/domain/queueFilters";
import { runDeadlineSweep } from "@/agents/deadlineAgent";
import { dateShort, requestStatusLabel } from "@/lib/format";
import { requireStaff } from "@/auth/guards";
import { portalSignOut } from "../../actions";
import { AiPill, Avatar, StatusPill } from "../../../_components/ui";
import { QueueFilterBar } from "../../../_components/QueueFilterBar";
import { QueueTable, type QueueRowVM } from "../../../_components/QueueTable";

// Reads the live database — never prerender a stale queue at build time.
export const dynamic = "force-dynamic";

export default async function Queue({
  params,
  searchParams,
}: {
  params: Promise<{ agency: string }>;
  searchParams: Promise<{ assignee?: string; status?: string; risk?: string; dept?: string }>;
}) {
  const [{ agency: slug }, sp] = await Promise.all([params, searchParams]);
  const staff = await requireStaff(slug);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const filters = parseQueueFilters(sp);

  // Closed requests are out of the race — the clock stopped at closedAt.
  const allOpen = ws.requests.filter((r) => r.closedAt == null);
  const closedRequests = ws.requests.filter((r) => r.closedAt != null);

  // The deadline agent runs its nightly sweep (pure logic, no model) and hands
  // the coordinator a morning digest (§16.1).
  const sweep = await runDeadlineSweep({
    now: ws.now,
    queue: allOpen.map((r) => ({
      publicId: r.publicId,
      dueAt: r.dueAt,
      outstandingTasks: outstandingTasks(r),
      complexityScore: r.complexityScore ?? 0, // untriaged → no complexity signal yet
    })),
  });

  // Risk is computed for EVERY open request (the stat row must reflect the
  // whole queue, not the filtered view); filtering happens after.
  const scored = allOpen
    .map((r) => ({
      r,
      risk: deadlineRisk({
        dueAt: r.dueAt,
        now: ws.now,
        outstandingTasks: outstandingTasks(r),
        complexityScore: r.complexityScore ?? 0,
      }),
    }))
    .sort((a, b) => byRiskDesc(a.risk, b.risk));

  const rows: QueueRowVM[] = scored
    .filter(({ r, risk }) =>
      matchesQueueFilters(
        {
          assignedCoordinatorId: r.assignedCoordinatorId,
          status: r.status,
          riskBand: risk.band,
          departmentIds: r.tasks.map((t) => t.departmentId).filter((d): d is string => d != null),
        },
        filters,
        staff.userId,
      ),
    )
    .map(({ r, risk }) => ({
      id: r.id,
      publicId: r.publicId,
      interpretedScope: r.interpretedScope,
      requesterName: r.requesterName,
      requesterType: r.requesterType,
      status: r.status,
      triageReady: r.triageReady,
      redFlags: r.redFlags,
      assignedCoordinatorId: r.assignedCoordinatorId,
      assignedCoordinatorName: r.assignedCoordinatorName,
      dueAtISO: r.dueAt.toISOString(),
      riskBand: risk.band,
      riskScore: risk.score,
      daysRemaining: risk.daysRemaining,
    }));

  const open = allOpen.length;
  const overdue = scored.filter((x) => x.risk.band === "overdue").length;
  const decisions = decisionsFor(allOpen, ws.now);
  const workload = workloadFor(ws.departments, ws.requests);

  // Only statuses actually present in the open queue — an empty filter option
  // is a dead end.
  const availableStatuses = [...new Set(allOpen.map((r) => r.status))].sort();
  let assignableStaff: { id: string; name: string }[] = [];
  if (ws.source === "live" && ws.agencyId) {
    const repo = await getRepository();
    assignableStaff = (await repo.listUsers(ws.agencyId))
      .filter((u) => isAssignableRole(u.role))
      .map((u) => ({ id: u.id, name: u.name ?? u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Honest numbers: computed from the live DB, or the fixture's story numbers
  // when we're showing the unseeded demo. "—" beats a made-up percentage.
  let onTimeLabel = "94%";
  let deflectionsLabel = "41";
  // Agency-wide retention warnings (same computation as the nightly sweep) —
  // a record destroyed on schedule while requested is the unrecoverable one.
  let retentionRisk: { filename: string; status: RetentionStatus }[] = [];
  // Repeated-demand patterns (same computation as the librarian's nightly
  // sweep) — proposals only; publishing stays a named human's act.
  let demandPatterns: DemandPattern[] = [];
  // Agent runs parked at a human checkpoint — the /app/agents badge.
  let parkedAgentRuns = 0;
  if (ws.source === "live" && ws.agencyId) {
    const repo = await getRepository();
    parkedAgentRuns = (await repo.listAgentRuns(ws.agencyId)).filter(
      (r) => r.status === "awaiting_checkpoint",
    ).length;
    retentionRisk = documentsAtRetentionRisk(
      await repo.listDocumentsUnderRetention(ws.agencyId),
      ws.now,
    ).map(({ doc, status }) => ({ filename: doc.filename ?? doc.id, status }));
    const deflections = await repo.listDeflections(ws.agencyId);
    const monthStart = new Date(ws.now.getFullYear(), ws.now.getMonth(), 1);
    // archive_miss rows are demand signal, not deflections — never ROI.
    deflectionsLabel = String(
      deflections.filter((d) => d.kind !== "archive_miss" && d.createdAt >= monthStart).length,
    );

    const allRequests = await repo.listRequests(ws.agencyId);
    // Shared signal builder (domain/transparencyImpact) — the reports page's
    // impact section mines the same signals, so the two can never diverge.
    demandPatterns = mineDemandPatterns(demandSignalsFrom(allRequests, deflections), { now: ws.now });

    const closedRequests = ws.requests.filter((r) => r.closedAt != null);
    onTimeLabel = closedRequests.length
      ? `${Math.round((closedRequests.filter((r) => r.closedAt! <= r.dueAt).length / closedRequests.length) * 100)}%`
      : "—";
  }

  return (
    <div className="wrap" style={{ paddingBlock: "36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">{ws.agencyName} · Records oversight</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>Command center</h1>
        </div>
        {/* Navigation lives in the persistent StaffNav rail now — the header
            keeps only what the rail can't say: a parked-agents alert and the
            session controls. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {parkedAgentRuns > 0 && (
            <Link href={`/${slug}/app/agents`} className="btn btn-sm" style={{ borderColor: "var(--due)" }}>
              ⏸ {parkedAgentRuns} agent run{parkedAgentRuns === 1 ? "" : "s"} awaiting approval
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
          <div className="stat-num">{onTimeLabel}</div>
          <div className="stat-label">On-time rate</div>
        </div>
        <div className="stat">
          <div className="stat-num" style={{ color: "var(--ai)" }}>
            {deflectionsLabel}
          </div>
          <div className="stat-label">Deflections this month</div>
        </div>
      </div>

      {/* Retention warnings — surfaced before anything is destroyed on
          schedule, because that mistake has no undo. Display only: placing a
          hold stays a named human's act on the request page. */}
      {retentionRisk.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 20, borderColor: "var(--due)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="panel-title">⚠ Records nearing scheduled destruction</div>
            <span className="pill band-due_soon">{retentionRisk.length}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 6 }}>
            {retentionRisk.slice(0, 6).map((d, i) => (
              <li key={i} style={{ fontSize: "0.88rem", display: "flex", gap: 8, alignItems: "baseline" }}>
                <span className="mono" style={{ fontSize: "0.8rem" }}>{d.filename}</span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>{d.status.label}</span>
              </li>
            ))}
            {retentionRisk.length > 6 && (
              <li className="muted" style={{ fontSize: "0.8rem" }}>…and {retentionRisk.length - 6} more</li>
            )}
          </ul>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
            If any of these are responsive to an open request, place a legal hold from that
            request&apos;s page before the schedule runs out. Documents already under a hold are not
            listed — a hold is the protection working.
          </p>
        </div>
      )}

      {/* Disclosure librarian (Phase 5 B1): repeated demand the archive isn't
          answering. Proposals only — publishing a record is, and stays, a
          named human's act (invariant 9). */}
      {demandPatterns.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 20, borderColor: "var(--ai-border, var(--border))" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="panel-title">Proactive disclosure opportunities</div>
            <span className="pill">{demandPatterns.length}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
            {demandPatterns.map((p, i) => (
              <li key={i} style={{ fontSize: "0.88rem", display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{p.topic}</span>
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  {p.requests > 0 ? `${p.requests} request${p.requests === 1 ? "" : "s"}` : null}
                  {p.queries > 0 ? ` · ${p.queries} search${p.queries === 1 ? "" : "es"}` : null}
                  {p.misses > 0 ? ` · ${p.misses} unanswered` : null}
                  {p.refs.length > 0 ? ` · ${p.refs.slice(0, 3).join(", ")}` : null}
                </span>
                <Link
                  href={`/${slug}/app/search?q=${encodeURIComponent(p.keywords.join(" "))}`}
                  className="btn btn-sm"
                >
                  Find the records
                </Link>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ fontSize: "0.8rem", marginTop: 8 }}>
            Repeated asks the public archive isn&apos;t answering (from requests, searches, and
            misses over the last 90 days). Publishing anything is your call, made per record —
            the librarian only points at the demand.
          </p>
        </div>
      )}

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

      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 28, marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: "1.15rem", margin: 0 }}>
          Open requests <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>· by deadline risk</span>
          {rows.length !== open && (
            <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
              {" "}· showing {rows.length} of {open}
            </span>
          )}
        </h2>
        <QueueFilterBar
          agencySlug={slug}
          userId={staff.userId}
          basePath={`/${slug}/app`}
          filters={filters}
          availableStatuses={availableStatuses}
          departments={ws.departments.map((d) => ({ id: d.id, name: d.name }))}
        />
      </div>

      <QueueTable
        agencySlug={slug}
        currentUserId={staff.userId}
        rows={rows}
        assignableStaff={assignableStaff}
        emptyMessage={
          hasActiveFilters(filters)
            ? "Nothing matches these filters."
            : "No requests yet — file one from the portal and it lands here."
        }
      />


      {closedRequests.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.15rem", marginTop: 28, marginBottom: 12 }}>
            Recently closed{" "}
            <span className="muted" style={{ fontWeight: 400, fontSize: "0.9rem" }}>
              · {closedRequests.length}
            </span>
          </h2>
          <div className="card" style={{ overflow: "hidden" }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {closedRequests
                .sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0))
                .map((r) => (
                  <li
                    key={r.id}
                    style={{ display: "flex", gap: 12, alignItems: "center", padding: "13px 16px", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}
                  >
                    <span className={`pill ${r.closedAt && r.closedAt <= r.dueAt ? "band-on_track" : "band-overdue"}`}>
                      {r.closedAt && r.closedAt <= r.dueAt ? "On time" : "Late"}
                    </span>
                    <Link href={`/${slug}/app/requests/${r.id}`} style={{ fontWeight: 600, color: "var(--ink)", flex: 1, minWidth: 220 }}>
                      {r.interpretedScope}
                    </Link>
                    <span className="mono muted" style={{ fontSize: "0.78rem" }}>
                      {r.publicId}
                    </span>
                    <StatusPill label={requestStatusLabel(r.status)} />
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      closed {r.closedAt ? dateShort(r.closedAt) : ""}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}

      <style>{`
        .cc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 820px) { .cc-grid { grid-template-columns: 1fr; }
          .stat-row { grid-template-columns: repeat(2, 1fr) !important; } }
      `}</style>
    </div>
  );
}
