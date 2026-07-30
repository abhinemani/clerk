import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getRequestDetail, outstandingTasks } from "@/lib/live";
import { deadlineRisk, type RiskBand } from "@/domain/deadlineRisk";
import { canTransition } from "@/domain/requestLifecycle";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { requireStaff } from "@/auth/guards";
import { DeadlineBand, StatusPill } from "../../../../../_components/ui";
import {
  CorrespondencePanel,
  type MessageVM,
} from "../../../../../_components/CorrespondencePanel";
import { getStateProfile } from "@/statute/profiles";
import {
  ExtensionPanel,
  type ExtensionTakenVM,
} from "../../../../../_components/ExtensionPanel";
import {
  ReviewRelease,
  type ExemptionOptionVM,
  type ReleaseVM,
  type ReviewDocVM,
} from "../../../../../_components/ReviewRelease";
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

  // Review set + release state + correspondence (live requests only — the
  // demo fixture has none of these).
  interface AiRoutingSuggestion {
    departmentId: string | null;
    department: string;
    scope: string;
    rationale: string;
  }
  let reviewDocs: ReviewDocVM[] = [];
  let releaseVM: ReleaseVM | null = null;
  let messageVMs: MessageVM[] = [];
  let exemptionOptions: ExemptionOptionVM[] = [];
  let aiRouting: AiRoutingSuggestion[] | null = null;
  let extensionVM: {
    maxDays: number;
    dayType: "calendar" | "business";
    reasons: string[];
    taken: ExtensionTakenVM | null;
    available: boolean;
  } | null = null;
  if (detail.source === "live") {
    const staff = await requireStaff(slug);
    const repo = await getRepository();
    const agencyRow = await repo.getAgency(staff.agencyId);
    const profile = agencyRow ? getStateProfile(agencyRow.stateCode) : null;
    exemptionOptions =
      profile?.exemptions.map((e) => ({ citation: e.statuteSection, label: e.shortLabel })) ?? [];
    const [docs, reviews, releases, msgs, staffUsers, events, rawRequest] = await Promise.all([
      repo.listRequestDocuments(staff.agencyId, r.id),
      repo.listReviews(staff.agencyId, r.id),
      repo.listReleases(staff.agencyId, r.id),
      repo.listMessages(staff.agencyId, r.id),
      repo.listUsers(staff.agencyId),
      repo.listEvents(staff.agencyId, r.id),
      repo.getRequest(staff.agencyId, r.id),
    ]);
    const extConfig = profile?.responseClock.extension;
    if (extConfig) {
      const taken = rawRequest?.extensionHistory?.[0] ?? null;
      extensionVM = {
        maxDays: extConfig.maxDays,
        dayType: extConfig.dayType,
        reasons: extConfig.permittedReasons,
        taken: taken
          ? { days: taken.days, reason: taken.reason, atLabel: dateShort(new Date(taken.at)) }
          : null,
        available:
          extConfig.allowed && !taken && r.closedAt == null && rawRequest?.statutoryDueAt != null,
      };
    }
    // The latest §6.3 routing run, if the pipeline has proposed one.
    const routingEvent = [...events]
      .reverse()
      .find((e) => e.kind === "ai_action" && (e.payload as { pipeline?: string } | undefined)?.pipeline === "routing_suggestions");
    aiRouting =
      ((routingEvent?.payload as { suggestions?: AiRoutingSuggestion[] } | undefined)?.suggestions ?? null);
    const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name ?? u.email]));
    messageVMs = msgs.map((m) => ({
      id: m.id,
      direction: m.direction,
      subject: m.subject,
      body: m.body,
      aiDrafted: m.aiDrafted,
      senderName: m.sentByUserId ? (staffNameById.get(m.sentByUserId) ?? "Staff") : null,
      atLabel: dateShort(m.sentAt),
    }));
    const reviewByDoc = new Map(reviews.map((rv) => [rv.documentId, rv]));
    reviewDocs = docs
      .filter((d) => d.classification === "internal") // the review set, not archive entries
      .map((d) => ({
        documentId: d.id,
        filename: d.filename ?? d.id,
        pages: typeof d.metadata?.pages === "number" ? d.metadata.pages : null,
        hasBlob: d.byteSize != null, // real bytes in the blob store
        decision: reviewByDoc.get(d.id)?.decision ?? null,
        exemptionLabel: reviewByDoc.get(d.id)?.exemptionLabel ?? null,
      }));
    const rel = releases[0];
    if (rel) {
      const approver = await repo.getUser(staff.agencyId, rel.approvedByUserId);
      releaseVM = {
        released: rel.artifacts.length,
        visibility: rel.visibility,
        releasedAtLabel: dateShort(rel.releasedAt),
        approverName: approver?.name ?? approver?.email ?? "staff",
        responseLetter: rel.responseLetter,
      };
    }
  }

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

  // Routing suggestions: the §6.3 pipeline's proposal when it has run, else
  // the placeholder heuristic. Either way, only departments not yet tasked.
  const taskedDeptIds = new Set(r.tasks.map((t) => t.departmentId));
  const suggestions: SuggestionVM[] = aiRouting
    ? aiRouting
        .filter((s) => s.departmentId && !taskedDeptIds.has(s.departmentId))
        .map((s) => ({
          id: s.departmentId!,
          deptName: s.department,
          scope: s.scope,
          rationale: s.rationale,
        }))
    : departments
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

          {extensionVM && (
            <ExtensionPanel
              key={`ext|${extensionVM.taken ? "taken" : "open"}|${dateShort(r.dueAt)}`}
              agencySlug={slug}
              requestId={r.id}
              dueLabel={`Due ${dateShort(r.dueAt)}`}
              maxDays={extensionVM.maxDays}
              dayType={extensionVM.dayType}
              reasons={extensionVM.reasons}
              taken={extensionVM.taken}
              available={extensionVM.available}
            />
          )}

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
            <ol className="audit-trail">
              {timeline.map((e, i) => (
                <li key={i}>
                  <span
                    aria-hidden
                    className={`audit-dot${e.tone === "ai" ? " tone-ai" : e.tone === "alert" ? " tone-alert" : ""}`}
                  />
                  <div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 500 }}>{e.title}</div>
                    <div className="muted" style={{ fontSize: "0.78rem", marginTop: 1 }}>
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
          closed={r.closedAt != null}
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

      {/* Correspondence — the clarification loop with the requester */}
      {detail.source === "live" && (
        <div style={{ marginTop: 24, maxWidth: 720 }}>
          <CorrespondencePanel
            key={`${messageVMs.length}|${r.status}`}
            agencySlug={slug}
            requestId={r.id}
            messages={messageVMs}
            canRequestClarification={canTransition(r.status, "clarification_needed")}
            awaitingReply={r.status === "clarification_needed"}
            requesterReachable={r.requesterEmail != null}
            requesterName={r.requesterName}
            closed={r.closedAt != null}
          />
        </div>
      )}

      {/* Review & release — appears once departments have submitted records */}
      {(reviewDocs.length > 0 || releaseVM || r.status === "denied") && (
        <div style={{ marginTop: 24, maxWidth: 720 }}>
          <ReviewRelease
            key={`${reviewDocs.map((d) => `${d.documentId}:${d.decision}`).join(",")}|${releaseVM ? "released" : "open"}|${r.status}`}
            agencySlug={slug}
            requestId={r.id}
            docs={reviewDocs}
            release={releaseVM}
            denied={r.status === "denied" || (r.status === "closed" && !releaseVM && reviewDocs.some((d) => d.decision === "withhold"))}
            exemptionOptions={exemptionOptions}
          />
        </div>
      )}

      <style>{`
        .detail-grid { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; }
        @media (max-width: 980px) { .detail-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
