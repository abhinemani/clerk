import Link from "next/link";
import { notFound } from "next/navigation";
import { DEMO_NOW, getDepartment, getRequest, DEMO_DEPARTMENTS } from "@/lib/demo";
import { deadlineRisk, type RiskBand } from "@/domain/deadlineRisk";
import { isTaskTerminal } from "@/domain/taskWorkflow";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { DeadlineBand, StatusPill } from "../../../_components/ui";
import {
  RequestWorkspace,
  type SuggestionVM,
  type TaskVM,
} from "../../../_components/RequestWorkspace";

const BAND_LABEL: Record<RiskBand, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
  on_track: "On track",
};

const MS_DAY = 86_400_000;
const daysFromNow = (d: Date) => Math.round((d.getTime() - DEMO_NOW.getTime()) / MS_DAY);

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getRequest(id);
  if (!r) notFound();

  const outstanding = r.tasks.filter((t) => !isTaskTerminal(t.status)).length;
  const risk = deadlineRisk({
    dueAt: r.dueAt,
    now: DEMO_NOW,
    outstandingTasks: outstanding,
    complexityScore: r.complexityScore,
  });

  const tasks: TaskVM[] = r.tasks.map((t) => {
    const dept = getDepartment(t.departmentId);
    const dr = daysFromNow(t.dueAt);
    return {
      id: t.id,
      token: t.token,
      deptName: dept?.name ?? "Department",
      deptLead: dept?.lead ?? "Lead",
      deptEmail: dept?.email ?? "",
      scope: t.scope,
      status: t.status,
      dueLabel: `internal ${daysLabel(dr)}`,
      uploads: t.uploads,
      pushbackNote: t.pushbackNote,
    };
  });

  // Routing suggestions = departments not yet tasked (the AI's proposal to dispatch).
  const taskedDeptIds = new Set(r.tasks.map((t) => t.departmentId));
  const suggestions: SuggestionVM[] = DEMO_DEPARTMENTS.filter((d) => !taskedDeptIds.has(d.id))
    .slice(0, 1)
    .map((d) => ({
      id: d.id,
      deptName: d.name,
      scope: `${d.name}: check for any records responsive to “${r.interpretedScope}”.`,
      rationale: `Similar past requests were partly fulfilled by ${d.name}.`,
    }));

  const timeline = buildTimeline(r);

  return (
    <div className="wrap" style={{ paddingBlock: "28px 8px" }}>
      <Link href="/app" className="muted" style={{ fontSize: "0.9rem" }}>
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
            <div className="panel-title">Timeline</div>
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

        {/* Center + right — the interactive workspace (client) */}
        <RequestWorkspace
          triage={{
            interpretedScope: r.interpretedScope,
            recordTypes: r.recordTypes,
            redFlags: r.redFlags,
            complexityPct: Math.round(r.complexityScore * 100),
          }}
          initialTasks={tasks}
          initialSuggestions={suggestions}
          agencySlug="riverton"
        />
      </div>

      <style>{`
        .detail-grid { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; }
        @media (max-width: 980px) { .detail-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

function buildTimeline(r: ReturnType<typeof getRequest> & object) {
  const events: { title: string; meta: string; tone?: "ai" | "alert" }[] = [
    { title: "Request received via portal", meta: `${dateShort(r.receivedAt)} · ${titleCase(r.requesterType)} requester` },
    { title: "AI triage completed", meta: "Interpreted scope + red flags drafted", tone: "ai" },
  ];
  if (r.tasks.length > 0) {
    events.push({ title: `Routed to ${r.tasks.length} department${r.tasks.length === 1 ? "" : "s"}`, meta: "Tasks dispatched", tone: "ai" });
  }
  for (const t of r.tasks) {
    const dept = getDepartment(t.departmentId)?.name ?? "Department";
    if (t.status === "submitted")
      events.push({ title: `${dept} submitted records`, meta: `${t.uploads.length} document(s)` });
    if (t.status === "done") events.push({ title: `${dept} records accepted`, meta: "Coordinator review complete" });
    if (t.status === "pushed_back")
      events.push({ title: `${dept} pushed back`, meta: "Needs coordinator decision", tone: "alert" });
  }
  return events;
}
