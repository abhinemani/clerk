import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/db/createRepository";
import { getRequestDetail, outstandingTasks } from "@/lib/live";
import { isAssignableRole } from "@/domain/workflow";
import { deadlineRisk, type RiskBand } from "@/domain/deadlineRisk";
import { canTransition } from "@/domain/requestLifecycle";
import { daysLabel, dateShort, requestStatusLabel, titleCase } from "@/lib/format";
import { requireStaff } from "@/auth/guards";
import { DeadlineBand, StatusPill } from "../../../../../_components/ui";
import { AnswerWithLink } from "../../../../../_components/AnswerWithLink";
import { AssigneeSelect } from "../../../../../_components/AssigneeSelect";
import {
  ReferPanel,
  type CustodianProposalVM,
  type ReferTargetVM,
} from "../../../../../_components/ReferPanel";
import {
  CorrespondencePanel,
  type MessageVM,
} from "../../../../../_components/CorrespondencePanel";
import { getStateProfile } from "@/statute/profiles";
import { CopilotChat } from "../../../../../_components/CopilotChat";
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
import { MailboxImportPanel } from "../../../../../_components/MailboxImportPanel";
import { placeLegalHoldFormAction } from "./actions";
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
  interface DuplicateMatchVM {
    requestId: string;
    publicId: string;
    similarity: number;
    status: string;
  }
  let reviewDocs: ReviewDocVM[] = [];
  let releaseVM: ReleaseVM | null = null;
  let messageVMs: MessageVM[] = [];
  let exemptionOptions: ExemptionOptionVM[] = [];
  let aiRouting: AiRoutingSuggestion[] | null = null;
  let duplicates: DuplicateMatchVM[] = [];
  let extensionVM: {
    maxDays: number;
    dayType: "calendar" | "business";
    reasons: string[];
    taken: ExtensionTakenVM | null;
    available: boolean;
  } | null = null;
  // Assignment (§6.3 queue ergonomics): current owner + who could own it.
  let assignableStaff: { id: string; name: string }[] = [];
  let assigneeId: string | null = null;
  // Retention: documents in this review set at risk of destruction, and the
  // holds protecting the rest. Spoliation is the failure this surfaces.
  let retentionRisk: { documentId: string; filename: string; label: string }[] = [];
  let heldCount = 0;
  // Referral: who we can point this requester at, and where it already went.
  let referTargets: ReferTargetVM[] = [];
  let referredTo: { name: string; contactEmail: string | null; portalUrl: string | null } | null = null;
  let referredAtLabel: string | null = null;
  let custodianProposal: CustodianProposalVM | null = null;
  // Phase-3 forwarding, both directions — rendered from denormalized
  // snapshots; no cross-tenant read happens here.
  let forwardedTo: { agencyName: string; publicId: string; trackPath: string } | null = null;
  let forwardedFrom: { agencyName: string; publicId: string; atLabel: string } | null = null;
  // Already public? The same archive retrieval the pre-filing interstitial
  // uses, run for STAFF post-filing: if the agency already released records
  // answering this request, the fastest correct response is a link, not a
  // fresh production. This agency's own public archive only (invariant 3
  // holds by construction — the corpus is public).
  let archiveMatches: { id: string; title: string; dateLabel: string; downloadUrl: string | null; syncedFrom: string | null }[] = [];
  let requesterHasEmail = false;
  // Learned precedent (docs/learning-loop.md): how the office resolved
  // similar past requests — consulted live so nightly rebuilds keep it fresh.
  let playVM: {
    topic: string;
    episodes: number;
    medianDays: number | null;
    extensionPct: number;
    topRoute: string | null;
    exemptions: string[];
    samples: string[];
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
    if (rawRequest) {
      const { consultPlays } = await import("@/services/learningService");
      const { defaultDeps } = await import("@/services/deps");
      const match = await consultPlays(defaultDeps(repo), {
        agencyId: staff.agencyId,
        text: rawRequest.interpretedScope ?? rawRequest.rawText,
      });
      if (match) {
        const { stats } = match.play;
        playVM = {
          topic: match.play.topic,
          episodes: match.play.episodeCount,
          medianDays: stats.medianDaysToClose,
          extensionPct: Math.round(stats.extensionRate * 100),
          topRoute: stats.routes[0] ? `${stats.routes[0].department} (${Math.round(stats.routes[0].share * 100)}%)` : null,
          exemptions: stats.exemptions.slice(0, 3).map((e) => e.label),
          samples: stats.samplePublicIds.filter((p) => p !== r.publicId).slice(0, 3),
        };
      }
    }

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
    // §6.2: possible duplicates recorded at filing time.
    const dupEvent = [...events]
      .reverse()
      .find((e) => e.kind === "ai_action" && (e.payload as { pipeline?: string } | undefined)?.pipeline === "duplicate_check");
    duplicates =
      ((dupEvent?.payload as { matches?: DuplicateMatchVM[] } | undefined)?.matches ?? []).filter(
        (m) => m.requestId,
      );
    const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name ?? u.email]));
    assignableStaff = staffUsers
      .filter((u) => isAssignableRole(u.role))
      .map((u) => ({ id: u.id, name: u.name ?? u.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
    assigneeId = rawRequest?.assignedCoordinatorId ?? null;
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
    const { readDocumentMeta } = await import("@/domain/documentMeta");
    reviewDocs = docs
      .filter((d) => d.classification === "internal") // the review set, not archive entries
      .map((d) => {
        const aiClass = (d.metadata as {
          aiClassification?: { recordType?: string; sensitivityNote?: string | null };
        } | null)?.aiClassification;
        const meta = readDocumentMeta(d);
        const isEmail = d.provenance === "email_ingest" && d.mimeType === "message/rfc822";
        return {
          documentId: d.id,
          filename: d.filename ?? d.id,
          pages: typeof d.metadata?.pages === "number" ? d.metadata.pages : null,
          hasBlob: d.byteSize != null, // real bytes in the blob store
          decision: reviewByDoc.get(d.id)?.decision ?? null,
          exemptionLabel: reviewByDoc.get(d.id)?.exemptionLabel ?? null,
          aiRecordType: aiClass?.recordType ?? null,
          aiSensitivityNote: aiClass?.sensitivityNote ?? null,
          // Email-ingest docs thread in the review panel; everything else
          // renders flat exactly as before.
          email: isEmail
            ? {
                messageId: meta.emailMessageId ?? null,
                inReplyTo: meta.emailInReplyTo ?? null,
                references: meta.emailReferences ?? [],
                subject: meta.emailSubject ?? meta.title ?? null,
                from: meta.emailFrom ?? null,
                dateIso: meta.recordDate ?? null,
              }
            : undefined,
          attachmentOfDocumentId:
            d.provenance === "email_ingest" ? meta.attachmentOfDocumentId ?? null : null,
        };
      });
    {
      const { documentsAtRetentionRisk, retentionStatus } = await import("@/domain/retention");
      const reviewSet = docs.filter((d) => d.classification === "internal");
      retentionRisk = documentsAtRetentionRisk(reviewSet, now).map(({ doc, status }) => ({
        documentId: doc.id,
        filename: doc.filename ?? doc.id,
        label: status.label,
      }));
      heldCount = reviewSet.filter((d) => retentionStatus(d, now).state === "held").length;
    }
    {
      const directory = await repo.listDirectory(staff.agencyId);
      referTargets = directory.map((d) => ({
        id: d.id,
        name: d.name,
        jurisdictionType: d.jurisdictionType,
        contactEmail: d.contactEmail,
        recordTypes: d.recordTypes,
        peerLinked: d.peerAgencyId != null && d.peerAgencyId !== staff.agencyId,
      }));
      if (rawRequest?.forwardedTo) {
        forwardedTo = {
          agencyName: rawRequest.forwardedTo.agencyName,
          publicId: rawRequest.forwardedTo.publicId,
          trackPath: `/${rawRequest.forwardedTo.agencySlug}/track?id=${encodeURIComponent(rawRequest.forwardedTo.publicId)}`,
        };
      }
      if (rawRequest?.forwardedFrom) {
        forwardedFrom = {
          agencyName: rawRequest.forwardedFrom.agencyName,
          publicId: rawRequest.forwardedFrom.publicId,
          atLabel: dateShort(new Date(rawRequest.forwardedFrom.at)),
        };
      }
      if (r.closedAt == null) {
        try {
          const { searchArchive } = await import("@/lib/archive");
          archiveMatches = (await searchArchive(slug, r.interpretedScope || r.rawText))
            .slice(0, 3)
            .map((it) => ({
              id: it.id,
              title: it.title,
              dateLabel: it.date,
              downloadUrl: it.downloadUrl,
              // Connected-source provenance: the named human answering by
              // link should know they are citing SYNCED data and how fresh
              // it is (docs/connected-sources.md).
              syncedFrom: it.connectedSource
                ? `${it.connectedSource.sourceName}, last synced ${it.connectedSource.syncedAt.slice(0, 10)}`
                : null,
            }));
        } catch (e) {
          console.error("archive match for request detail failed", e);
        }
        if (rawRequest?.requesterId) {
          const req = await repo.getRequester(staff.agencyId, rawRequest.requesterId);
          requesterHasEmail = req?.email != null;
        }
      }
      // Phase-2 custodian suggestion: the latest run's top proposal pre-selects
      // the Refer panel. The card only proposes — staff still click Refer.
      const custodianEvent = [...events]
        .reverse()
        .find((e) => e.kind === "ai_action" && (e.payload as { pipeline?: string } | undefined)?.pipeline === "custodian_suggest");
      const proposals =
        (custodianEvent?.payload as { proposals?: CustodianProposalVM[] } | undefined)?.proposals ?? [];
      // Re-resolve against the live directory — the entry may be gone by now.
      custodianProposal =
        proposals.find((p) => directory.some((d) => d.id === p.directoryEntryId)) ?? null;
      if (rawRequest?.referredToDirectoryId) {
        const target = directory.find((d) => d.id === rawRequest.referredToDirectoryId);
        if (target) {
          referredTo = { name: target.name, contactEmail: target.contactEmail, portalUrl: target.portalUrl };
        }
        referredAtLabel = rawRequest.referredAt ? dateShort(rawRequest.referredAt) : null;
      }
    }
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
          {detail.source === "live" && (
            <Link
              href={`/${slug}/app/search?req=${r.id}&q=${encodeURIComponent(r.interpretedScope.split(/\s+/).slice(0, 8).join(" "))}`}
              className="btn btn-sm"
            >
              Find records
            </Link>
          )}
          <Link href={`/${slug}/app/requests/${r.id}/redact`} className="btn btn-sm">
            Redact records →
          </Link>
          {detail.source === "live" && (
            <a
              href={`/${slug}/app/requests/${r.id}/defensibility-report.pdf`}
              className="btn btn-sm"
              title="Full audit trail as a PDF — for counsel or an appeal"
            >
              Defensibility report
            </a>
          )}
          {detail.source === "live" && (
            <a
              href={`/${slug}/app/requests/${r.id}/appeal-packet.pdf`}
              className="btn btn-sm"
              title="Counsel dossier: deadline bases, exemption citations, letters, checksummed releases, drafted cover memo"
            >
              Appeal packet
            </a>
          )}
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

          {detail.source === "live" && assignableStaff.length > 0 && (
            <div className="card card-pad">
              <div className="panel-title">Assigned coordinator</div>
              <AssigneeSelect
                key={assigneeId ?? "unassigned"}
                agencySlug={slug}
                requestId={r.id}
                staff={assignableStaff}
                assigneeId={assigneeId}
              />
            </div>
          )}

          {/* Provenance: this request arrived by forward from a peer tenant.
              Snapshot only — the source agency's file stays theirs. */}
          {forwardedFrom && (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--accent)" }}>
              <div className="panel-title">Forwarded in</div>
              <p style={{ fontSize: "0.9rem", margin: "8px 0 0" }}>
                Sent over by <strong>{forwardedFrom.agencyName}</strong> on {forwardedFrom.atLabel}{" "}
                (their <span className="mono">{forwardedFrom.publicId}</span>). Their file stays
                with them — this one starts fresh here.
              </p>
            </div>
          )}

          {detail.source === "live" && (r.closedAt == null || referredTo || forwardedTo) && (
            <ReferPanel
              key={forwardedTo ? "forwarded" : referredTo ? "referred" : "open"}
              agencySlug={slug}
              requestId={r.id}
              targets={referTargets}
              referredTo={referredTo}
              referredAtLabel={referredAtLabel}
              forwardedTo={forwardedTo}
              aiProposal={custodianProposal}
            />
          )}

          {/* Already released: answering with a link beats working the
              request fresh — and the requester gets records TODAY. */}
          {archiveMatches.length > 0 && (
            <div className="card card-pad">
              <div className="panel-title">Already public?</div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0" }}>
                Released records in your archive match this request. If one answers it, reply with
                the link instead of producing it again.
              </p>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 8 }}>
                {archiveMatches.map((m) => (
                  <li key={m.id} style={{ fontSize: "0.88rem" }}>
                    {/* The permalink is the thing to send a requester — every
                        released record is a citable URL (§6.7). */}
                    <Link href={`/${slug}/archive/${m.id}`} style={{ fontWeight: 600 }}>
                      {m.title}
                    </Link>
                    <span className="muted" style={{ fontSize: "0.8rem" }}> · {m.dateLabel}</span>
                    {m.syncedFrom && (
                      <span style={{ fontSize: "0.8rem", color: "var(--ai)", marginLeft: 8 }}>
                        ⟳ synced data ({m.syncedFrom})
                      </span>
                    )}
                    {m.downloadUrl && (
                      <a className="muted" href={m.downloadUrl} style={{ fontSize: "0.8rem", marginLeft: 8 }}>
                        download
                      </a>
                    )}
                    <AnswerWithLink
                      agencySlug={slug}
                      requestId={r.id}
                      documentId={m.id}
                      title={m.title}
                      requesterHasEmail={requesterHasEmail}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Anti-spoliation: a record answering this request must not be
              destroyed on schedule while the request is still open. */}
          {retentionRisk.length > 0 && (
            <div className="card card-pad" style={{ borderColor: "var(--overdue-border)", background: "var(--overdue-bg)" }}>
              <div className="panel-title" style={{ color: "var(--overdue)" }}>
                Retention risk
              </div>
              <p style={{ fontSize: "0.88rem", margin: "6px 0 0" }}>
                {retentionRisk.length} document{retentionRisk.length === 1 ? " is" : "s are"} scheduled
                for destruction and not under hold. Destroying a record responsive to an open request
                is spoliation — place a hold before the schedule runs.
              </p>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
                {retentionRisk.map((d) => (
                  <li key={d.documentId} style={{ fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="mono">{d.filename}</span>
                    <span className="muted">— {d.label}</span>
                    {/* The named-human act: this staff member places the hold,
                        audited onto this request's trail. */}
                    <form
                      action={placeLegalHoldFormAction.bind(null, {
                        agencySlug: slug,
                        requestId: id,
                        documentId: d.documentId,
                      })}
                      style={{ marginLeft: "auto" }}
                    >
                      <button className="btn btn-sm" type="submit">
                        Place hold
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {heldCount > 0 && retentionRisk.length === 0 && (
            <div className="card card-pad">
              <div className="panel-title">Retention</div>
              <p className="muted" style={{ fontSize: "0.85rem", margin: "6px 0 0" }}>
                {heldCount} document{heldCount === 1 ? "" : "s"} held against destruction while this
                request is open.
              </p>
            </div>
          )}

          {duplicates.length > 0 && (
            <div className="card card-pad" style={{ borderColor: "var(--due-border)" }}>
              <div className="panel-title">Possibly related</div>
              <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 6 }}>
                {duplicates.map((d) => (
                  <li key={d.requestId} style={{ fontSize: "0.88rem" }}>
                    <Link href={`/${slug}/app/requests/${d.requestId}`} className="mono">
                      {d.publicId}
                    </Link>{" "}
                    <span className="muted">
                      · {Math.round(d.similarity * 100)}% similar · {requestStatusLabel(d.status as never)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: "0.78rem", marginTop: 8, marginBottom: 0 }}>
                Flagged at intake (§6.2). If it's the same ask, consider pointing the requester at
                the earlier release instead of re-fulfilling.
              </p>
            </div>
          )}

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

          {/* Learned precedent (docs/learning-loop.md): the office's own
              resolved history for this kind of ask — deterministic stats, no
              model. Advisory: routing/decisions stay named-human acts. */}
          {playVM && (
            <div className="card card-pad">
              <div className="panel-title">Similar past requests</div>
              <p style={{ fontSize: "0.88rem", margin: "8px 0 0" }}>
                {playVM.episodes} resolved request(s) about{" "}
                <span style={{ fontWeight: 600 }}>{playVM.topic}</span>
                {playVM.topRoute ? <> — mostly fulfilled by {playVM.topRoute}</> : null}.
              </p>
              <div className="muted" style={{ fontSize: "0.8rem", marginTop: 6 }}>
                {playVM.medianDays != null ? `Median ${playVM.medianDays} days to close. ` : ""}
                {playVM.extensionPct > 0 ? `${playVM.extensionPct}% took an extension. ` : ""}
                {playVM.exemptions.length > 0
                  ? `Exemptions cited before: ${playVM.exemptions.join(", ")}.`
                  : "No exemptions cited in past cases."}
              </div>
              {playVM.samples.length > 0 && (
                <div className="mono muted" style={{ fontSize: "0.76rem", marginTop: 6 }}>
                  Precedents: {playVM.samples.join(" · ")}
                </div>
              )}
            </div>
          )}

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
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          agencySlug={slug}
        />
      </div>

      {/* Coordinator copilot (§6.8) — proposes; every accept is a named-human
          action. Rendered only when live AI is configured; closed requests
          have nothing left to propose. */}
      {detail.source === "live" && r.closedAt == null && process.env.ANTHROPIC_API_KEY && (
        <div style={{ marginTop: 24, maxWidth: 720 }}>
          <CopilotChat agencySlug={slug} requestId={r.id} requesterName={r.requesterName} />
        </div>
      )}

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

      {/* Review & release — the review set once records exist, the release
          record afterward, or (for an empty set on a request where denial is
          a legal move) the no-records determination. */}
      {detail.source === "live" &&
        (reviewDocs.length > 0 ||
          releaseVM ||
          r.status === "denied" ||
          (r.closedAt == null && canTransition(r.status, "denied"))) && (
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

      {/* Email fulfillment: most responsive records ARE emails — bring in the
          custodian's export without asking IT for anything fancier. */}
      {detail.source === "live" && r.closedAt == null && (
        <div style={{ marginTop: 24, maxWidth: 720 }}>
          <MailboxImportPanel agencySlug={slug} requestId={r.id} />
        </div>
      )}

      <style>{`
        .detail-grid { display: grid; grid-template-columns: 280px 1fr; gap: 24px; align-items: start; }
        @media (max-width: 980px) { .detail-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
