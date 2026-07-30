import Link from "next/link";
import { notFound } from "next/navigation";
import { getRequestDetail, outstandingTasks } from "@/lib/live";
import { deadlineRisk, type RiskBand } from "@/domain/deadlineRisk";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { DeadlineBand, StatusPill } from "../../../../../_components/ui";
import {
  RequestWorkspace,
  type SuggestionVM,
  type TaskVM,
} from "../../../../../_components/RequestWorkspace";

// Reads the live database — render per-request, not at build time.
export const dynamic = "force-dynamic";

const BAND_LABEL: Record<RiskBand, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
};

const MS_DAY = 86_400_000;

export default async function RequestDetail({
  params,
}: {
  params: Promise<{ agency: string; id: string }>;
}) {
  const { agency: slug, id } = await params;
  const detail = await getRequestDetail(slug, id);
  if (!detail) notFound();
  const { now, departments, request: r, timeline } = detail;

  const daysFromNow = (d: Date) => Math.round((d.getTime() - now.getTime()) / MS_DAY);

  const risk = deadlineRisk({
    dueAt: r.dueAt,
    now,
    outstandingTasks: outstandingTasks(r),
    complexityScore: r.complexityScore ?? 0,
  });

  const tasks: TaskVM[] = r.tasks.map((t) => ({
    id: t.id,
    token: t.token,
    deptName: t.deptName,
    deptLead: t.deptLead,
    deptEmail: t.deptEmail,
    scope: t.scope,
    status: t.status,
    dueLabel: `internal ${daysLabel(daysFromNow(t.dueAt))}`,
    uploads: t.uploads,
    pushbackNote: t.pushbackNote,
  }));

  // Routing suggestions = departments not yet tasked (the AI's proposal to dispatch).
  const taskedDeptIds = new Set(r.tasks.map((t) => t.departmentId));
  const suggestions: SuggestionVM[] = departments
    .filter((d) => !taskedDeptIds.has(d.id))
    .slice(0, 1)
    .map((d) => ({
      id: d.id,
      deptName: d.name,
      scope: `${d.name}: check for any records responsive to “${r.interpretedScope}”.`,
      rationale: `Similar past requests were partly fulfilled by ${d.name}.`,
    }));

  return (
    <div className="wrap" style={{ paddingBlock: "28px 8px" }}>
      <Link href={`/${slug}/app`} className="muted" style={{ fontSize: "0.9rem" }}>
        ← Queue
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <span className="mono muted">{r.publicId}</span>
          <h1 className="serif" style={{ fontSize: "1.6rem", marginTop: 4, fontWeight: 600 }}>
            {r.interpretedScope}
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <DeadlineBand band={risk.band} label={`${BAND_LABEL[risk.band]} · ${dateShort(r.dueAt)}`} />
          <StatusPill label={requestStatusLabel(r.status)} />
          <Link href={`/${slug}/app/requests/${r.id}/redact`} className="btn btn-sm">
            Redact records →
          </Link>
        </div>
      </div>

      <div className="detail-grid" style={{ marginTop: 20 }}>
        {/* Left — timeline, requester, immutable request */}
        <aside className="stack" style={{ gap: 16 }}>
          <div className="card card-pad">
            <div className="panel-title">Requester</div>
            <div style={{ fontWeight: 600, marginTop: 8 }}>{r.requesterName}</div>
            <div className="muted" style={{ fontSize: "0.85rem" }}>
              {titleCase(r.requesterType)} · received {dateShort(r.receivedAt)}
            </div>
          </div>

          <div className="card card-pad">
            <div className="panel-title">Request as filed</div>
            <p style={{ fontSize: "0.9rem", marginTop: 8, color: "var(--ink-2)" }}>“{r.rawText}”</p>
            <div className="muted" style={{ fontSize: "0.76rem", marginTop: 8 }}>
              Immutable — the exact words the requester wrote.
            </div>
          </div>

          <div className="card card-pad">
            <div className="panel-title">
              Timeline
              {detail.source === "live" && (
                <span className="muted" style={{ fontWeight: 400, fontSize: "0.72rem", marginLeft: 6 }}>
                  · audit log
                </span>
              )}
            </div>
            <ol style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 14 }}>
              {timeline.map((e, i) => (
                <li key={i} style={{ display: "flex", gap: 10 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      marginTop: 6,
                      flex: "none",
                      background: e.tone === "ai" ? "var(--ai)" : e.tone === "alert" ? "var(--overdue)" : "var(--border-strong)",
                    }}
                  />
                  <div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 500 }}>{e.title}</div>
                    <div className="muted" style={{ fontSize: "0.78rem" }}>
                      {e.meta}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </aside>

        {/* Center + right — the interactive workspace (client). The key is a
            fingerprint of server state: after router.refresh() delivers new
            data, the component remounts with authoritative props instead of
            keeping stale optimistic useState. */}
        <RequestWorkspace
          key={`${r.status}|${r.interpretedScope}|${r.tasks.map((t) => `${t.id}:${t.status}:${t.uploads.length}`).join(",")}`}
          requestId={r.id}
          live={detail.source === "live"}
          triage={{
            interpretedScope: r.interpretedScope,
            recordTypes: r.recordTypes,
            redFlags: r.redFlags,
            complexityPct: Math.round((r.complexityScore ?? 0) * 100),
          }}
          initialTasks={tasks}
          initialSuggestions={suggestions}
          agencySlug={slug}
        />
      </div>

      <style>{`
        .detail-grid { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; }
        @media (max-width: 980px) { .detail-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
