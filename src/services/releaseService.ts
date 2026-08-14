/**
 * Review & release (spec §5 Review/Release, §10) — the end of a request's
 * life, and the invariant that defines this product: nothing reaches the
 * requester without a NAMED human approver. AI never releases.
 *
 * The flow: every responder upload became a document in the request's review
 * set; a coordinator decides each one (release / release_redacted / withhold);
 * approving the release freezes the artifact list into an immutable Release
 * row, notifies the requester, closes the statutory clock (closedAt — the
 * §11 metrics run on it), and — for public releases — publishes an archive
 * entry so the next resident finds these records without filing (§6.7).
 */
import { createHash } from "node:crypto";
import { composeDenialLetter, type DenialExemption } from "@/domain/denialLetter";
import { assertTransition } from "@/domain/requestLifecycle";
import { getStateProfile } from "@/statute/profiles";
import type { ServiceDeps } from "./deps";
import { sendStaffMessage } from "./messageService";
import { inboundAddress } from "./notifications";
import {
  NotFoundError,
  type ReleaseEntity,
  type RequestEntity,
  type ReviewDecision,
  type ReviewEntity,
} from "./repository";

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}

/** A named human decides one document's fate. Re-deciding replaces. */
export async function reviewDocument(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    requestId: string;
    documentId: string;
    decision: ReviewDecision;
    exemptionLabel?: string;
    actorUserId: string;
  },
): Promise<ReviewEntity> {
  if (input.decision !== "release" && !input.exemptionLabel?.trim()) {
    throw new ReleaseError("Withholding or redacting requires an exemption reason.");
  }
  const review = await deps.repo.upsertReview({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    documentId: input.documentId,
    decision: input.decision,
    exemptionLabel: input.decision === "release" ? null : (input.exemptionLabel?.trim() ?? null),
    decidedByUserId: input.actorUserId,
    createdAt: deps.now(),
  });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    kind: "note",
    actorUserId: input.actorUserId,
    summary: `Document decision: ${input.decision.replace(/_/g, " ")}`,
    payload: { documentId: input.documentId, decision: input.decision, exemptionLabel: input.exemptionLabel },
    createdAt: deps.now(),
  });
  return review;
}

export interface ReleaseOutcome {
  release: ReleaseEntity;
  request: RequestEntity;
  released: number;
  withheld: number;
}

/**
 * Approve the release. Requires a decision on EVERY document in the review
 * set; produces `fulfilled` (nothing withheld) or `partially_fulfilled`.
 */
export async function releaseRequest(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    requestId: string;
    actorUserId: string; // the named approver — required by the invariant
    visibility: "public" | "private";
    responseLetter?: string;
    /** Metadata for the public archive entry (public releases only). */
    archiveTitle?: string;
    archiveSummary?: string;
    /**
     * The §6.5 pre-release PII pass refuses full-release documents whose text
     * contains likely PII. Setting this proceeds anyway — recorded in the
     * approval event under the approver's name.
     */
    acceptResidualRisk?: boolean;
  },
): Promise<ReleaseOutcome> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  const [docs, reviews] = await Promise.all([
    repo.listRequestDocuments(input.agencyId, input.requestId),
    repo.listReviews(input.agencyId, input.requestId),
  ]);
  if (docs.length === 0) throw new ReleaseError("Nothing to release — no documents in the review set.");
  const decisionByDoc = new Map(reviews.map((r) => [r.documentId, r]));
  const undecided = docs.filter((d) => !decisionByDoc.has(d.id));
  if (undecided.length > 0) {
    throw new ReleaseError(
      `Every document needs a decision first — ${undecided.length} still undecided.`,
    );
  }

  const releasable = docs.filter((d) => decisionByDoc.get(d.id)!.decision !== "withhold");
  const withheld = docs.length - releasable.length;
  if (releasable.length === 0) {
    throw new ReleaseError(
      "Everything is withheld — deny the request instead of issuing an empty release.",
    );
  }

  // §6.5 last-line safety net on documents going out IN FULL (redacted copies
  // were already checked — and possibly overridden — at finalize time).
  const { checkResidualPii } = await import("@/ai/redaction/residualCheck");
  const { formatResidualSummary } = await import("./redactionService");
  const residualFlags: { filename: string; summary: Record<string, number> }[] = [];
  for (const d of releasable) {
    if (decisionByDoc.get(d.id)!.decision !== "release" || !d.extractedText) continue;
    const check = checkResidualPii(d.extractedText.split("\n"));
    if (!check.clean) residualFlags.push({ filename: d.filename ?? d.id, summary: check.summary });
  }
  if (residualFlags.length > 0 && !input.acceptResidualRisk) {
    throw new ReleaseError(
      `Possible PII in document(s) marked for full release: ` +
        residualFlags.map((f) => `"${f.filename}" (${formatResidualSummary(f.summary)})`).join("; ") +
        `. Redact them in the studio, or accept the flagged risk to release anyway.`,
    );
  }

  const now = deps.now();
  const artifacts: ReleaseEntity["artifacts"] = [];
  for (const d of releasable) {
    if (decisionByDoc.get(d.id)!.decision === "release_redacted") {
      // Invariant 1: a redacted release ships the BURNED artifact — never the
      // original bytes under a "-redacted" name. No artifact, no release.
      const { findRedactedArtifact } = await import("./redactionService");
      const artifact = await findRedactedArtifact(deps, input.agencyId, d.id);
      if (!artifact?.blobRef || !artifact.checksum) {
        throw new ReleaseError(
          `"${d.filename ?? d.id}" is marked release-with-redactions but has no finalized redacted copy. Finalize it in the redaction studio first.`,
        );
      }
      artifacts.push({
        blobRef: artifact.blobRef,
        filename: artifact.filename ?? `${d.id}-redacted.pdf`,
        checksum: artifact.checksum,
        documentId: artifact.id, // downloads resolve to the burned bytes
      });
      continue;
    }
    artifacts.push({
      blobRef: d.blobRef ?? d.filename ?? d.id,
      filename: d.filename ?? d.id,
      // Real stored bytes carry their sha-256; metadata-only docs get a
      // derived placeholder so the artifact list is always checksummed.
      checksum: d.checksum ?? createHash("sha256").update(`${d.id}:${d.filename}`).digest("hex").slice(0, 16),
      documentId: d.id,
    });
  }

  const responseLetter =
    input.responseLetter?.trim() ||
    defaultResponseLetter({
      publicId: request.publicId,
      released: artifacts.length,
      withheld,
      exemptions: reviews.filter((r) => r.decision !== "release" && r.exemptionLabel).map((r) => r.exemptionLabel!),
    });

  // The immutable delivery — named approver is NOT optional (§10).
  const release = await repo.createRelease({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    artifacts,
    responseLetter,
    visibility: input.visibility,
    approvedByUserId: input.actorUserId,
    releasedAt: now,
  });

  // Lifecycle: … → records_review → fulfilled | partially_fulfilled, and the
  // statutory clock stops.
  let current = request.status;
  if (current === "in_progress") {
    assertTransition(current, "records_review");
    await repo.updateRequest(input.agencyId, request.id, { status: "records_review" });
    current = "records_review";
  }
  const finalStatus = withheld > 0 ? "partially_fulfilled" : "fulfilled";
  assertTransition(current, finalStatus);
  const updated = await repo.updateRequest(input.agencyId, request.id, {
    status: finalStatus,
    closedAt: now,
  });

  // ---- The alias loop (docs/answer-first.md) -------------------------------
  // A fulfilled request is a named human asserting "this plain-language ask is
  // answered by these records". That pair is the only thing in the system that
  // teaches the archive the PUBLIC's vocabulary rather than the government's
  // filing language, and the workflow produces it for free — so record it.
  //
  // Written for every RELEASED document, public or not. Invariant 3 scopes
  // requester-facing retrieval at the query layer, so a private document's
  // aliases stay unreachable until a named human publishes it — and then the
  // history comes with it. Best-effort: a learning write must never be the
  // reason a lawful release fails.
  try {
    const ask = (request.interpretedScope ?? request.rawText ?? "").trim();
    if (ask) {
      const { readDocumentMeta, addAskAlias } = await import("@/domain/documentMeta");
      for (const d of releasable) {
        const next = addAskAlias(readDocumentMeta(d), ask);
        if (!next) continue;
        await repo.updateDocument(input.agencyId, d.id, {
          metadata: { ...(d.metadata ?? {}), askedAs: next },
        });
      }
    }
  } catch (e) {
    console.error("ask-alias write failed", e);
  }

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "approval",
    actorUserId: input.actorUserId,
    summary: `Release approved — ${artifacts.length} record(s) released${withheld ? `, ${withheld} withheld` : ""}`,
    payload: {
      releaseId: release.id,
      visibility: input.visibility,
      artifacts: artifacts.length,
      withheld,
      ...(residualFlags.length > 0
        ? { residualPiiOverride: { flags: residualFlags, overriddenBy: input.actorUserId } }
        : {}),
    },
    createdAt: now,
  });

  {
    const { emitStatusWebhook } = await import("./statusApiService");
    await emitStatusWebhook(deps, {
      agencyId: input.agencyId,
      publicId: request.publicId,
      event: "status_changed",
      to: finalStatus,
    });
  }

  // Deliver the response letter to the requester (recorded in the outbox).
  const requester = request.requesterId ? await repo.getRequester(input.agencyId, request.requesterId) : null;
  if (requester?.email) {
    const receipt = await deps.notifier?.send({
      agencyId: input.agencyId,
      to: requester.email,
      subject: `Your records are ready — ${request.publicId}`,
      body: responseLetter,
      kind: "requester_update",
      requestId: request.id,
      replyTo: inboundAddress("request", request.id),
    });
    if (receipt) {
      await repo.appendEvent({
        id: deps.genId(),
        agencyId: input.agencyId,
        requestId: request.id,
        kind: "delivery",
        actorUserId: input.actorUserId,
        summary: `Response letter delivered to ${requester.email}`,
        payload: { channel: receipt.channel, releaseId: release.id },
        createdAt: deps.now(),
      });
    }
  }

  // Public release → the archive grows and the answer box gets smarter (§6.7).
  if (input.visibility === "public") {
    const title = input.archiveTitle?.trim() || request.interpretedScope || request.rawText.slice(0, 80);
    const doc = await repo.createDocument({
      id: deps.genId(),
      agencyId: input.agencyId,
      sourceId: null,
      externalSystemId: `release-${release.id}`,
      filename: `${request.publicId.toLowerCase()}-release.pdf`,
      classification: "public",
      recordType: request.recordTypes[0] ?? null,
      processingStatus: "ready",
      metadata: {
        title,
        summary:
          input.archiveSummary?.trim() ||
          `${artifacts.length} record(s) released in response to request ${request.publicId}.`,
        tags: request.recordTypes,
        keywords: title.toLowerCase().split(/\W+/).filter((w) => w.length > 3),
        releasedOn: now.toISOString().slice(0, 10),
        releaseId: release.id,
      },
      createdAt: now,
    });
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      kind: "note",
      actorUserId: input.actorUserId,
      summary: "Published to the public archive",
      payload: { documentId: doc.id, releaseId: release.id },
      createdAt: deps.now(),
    });
  }

  return { release, request: updated, released: artifacts.length, withheld };
}

export interface DenyRequestInput {
  agencyId: string;
  requestId: string;
  /** The named human approving the denial — required (invariant 4). */
  actorUserId: string;
  /** Statute citations the denial rests on — at least one, unless noRecords. */
  exemptions: DenialExemption[];
  /** "No responsive records" determination — cites nothing, closes the request. */
  noRecords?: boolean;
  /** Optional staff explanation inserted into the letter. */
  explanation?: string;
  /** Staff-edited letter body; when absent the composed letter is used. */
  letterBody?: string;
  /** Provenance when letterBody came from the §6.6 pipeline (audited). */
  letterAiMeta?: { promptVersion: string; model: string };
}

export interface DenyOutcome {
  request: RequestEntity;
  letter: string;
}

/**
 * The formal denial (§6.6 denial, §7 appeal language): exemption-cited letter
 * with the statute profile's appeal rights verbatim, status → denied with the
 * clock stopped, the letter threaded into the request's correspondence and
 * delivered via the outbox — all under a named approver.
 */
export async function denyRequest(deps: ServiceDeps, input: DenyRequestInput): Promise<DenyOutcome> {
  const { repo } = deps;
  if (!input.actorUserId) throw new ReleaseError("A denial requires a named approver.");
  const exemptions = input.exemptions.filter((e) => e.citation?.trim());
  if (exemptions.length === 0 && !input.noRecords) {
    throw new ReleaseError("A denial must cite at least one exemption.");
  }

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  assertTransition(request.status, "denied"); // throws before anything is written

  const [agency, requester] = await Promise.all([
    repo.getAgency(input.agencyId),
    request.requesterId ? repo.getRequester(input.agencyId, request.requesterId) : null,
  ]);
  const profile = agency ? getStateProfile(agency.stateCode) : null;

  const letter =
    input.letterBody?.trim() ||
    composeDenialLetter({
      publicId: request.publicId,
      agencyName: agency?.name ?? "the agency",
      requesterName: requester?.name,
      requestSummary: request.interpretedScope ?? request.rawText,
      exemptions,
      noRecords: input.noRecords,
      appealProcess: profile?.appeal.process ?? null,
      appealDeadlineDays: profile?.appeal.deadlineDays ?? null,
      explanation: input.explanation,
    });

  const now = deps.now();
  const updated = await repo.updateRequest(input.agencyId, request.id, {
    status: "denied",
    closedAt: now, // the statutory clock stops on the determination
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "status_change",
    actorUserId: input.actorUserId,
    summary: `Status ${request.status} → denied`,
    payload: { from: request.status, to: "denied", exemptions: exemptions.map((e) => e.citation) },
    createdAt: now,
  });
  {
    const { emitStatusWebhook } = await import("./statusApiService");
    await emitStatusWebhook(deps, {
      agencyId: input.agencyId,
      publicId: request.publicId,
      event: "status_changed",
      to: "denied",
    });
  }
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "approval",
    actorUserId: input.actorUserId,
    summary: input.noRecords
      ? "Denial approved — no responsive records"
      : `Denial approved — ${exemptions.length} exemption(s) cited`,
    payload: {
      exemptions: exemptions.map((e) => ({ citation: e.citation, label: e.label })),
      noRecords: input.noRecords ?? false,
      appealIncluded: Boolean(profile?.appeal.process),
    },
    createdAt: now,
  });

  // The letter reaches the requester as correspondence: message thread + outbox.
  await sendStaffMessage(deps, {
    agencyId: input.agencyId,
    requestId: request.id,
    actorUserId: input.actorUserId,
    subject: `Determination on your records request ${request.publicId}`,
    body: letter,
    aiDrafted: input.letterAiMeta != null,
    aiMeta: input.letterAiMeta,
  });

  return { request: updated, letter };
}

function defaultResponseLetter(input: {
  publicId: string;
  released: number;
  withheld: number;
  exemptions: string[];
}): string {
  const lines = [
    `Re: Public records request ${input.publicId}`,
    ``,
    `Your request has been completed. ${input.released} responsive record(s) are enclosed.`,
  ];
  if (input.withheld > 0) {
    lines.push(
      ``,
      `${input.withheld} record(s) were withheld or redacted under the following exemption(s): ${[...new Set(input.exemptions)].join("; ")}.`,
      `You may appeal this determination as described in the enclosed notice.`,
    );
  } else if (input.exemptions.length > 0) {
    // Everything shipped, but some records carry burned redactions — the
    // exemption log still belongs in the letter (defensibility).
    lines.push(
      ``,
      `Some enclosed records include redactions under the following exemption(s): ${[...new Set(input.exemptions)].join("; ")}.`,
    );
  }
  lines.push(``, `Thank you for using the public records portal.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fulfill by reference — "the records you asked for are already public."
// ---------------------------------------------------------------------------

export interface FulfillByReferenceInput {
  agencyId: string;
  requestId: string;
  /** The named human deciding the public record answers the request (invariant 4). */
  actorUserId: string;
  /** The already-public archive document being cited. */
  documentId: string;
  /** Optional staff note prepended to the letter. */
  note?: string;
}

export interface FulfillByReferenceOutcome {
  request: RequestEntity;
  letter: string;
  requesterNotified: boolean;
}

/**
 * Close a request by citing records the agency has ALREADY released — the
 * fastest correct response when the archive holds the answer. No production,
 * no review set, no burn: the response letter carries the record's citable
 * permalink. Status → fulfilled (by reference), clock stopped, everything
 * audited. The cited document must be public — this can never become a side
 * door around review (invariant 3 mindset: the corpus it cites is already
 * public by definition).
 */
export async function fulfillByReference(
  deps: ServiceDeps,
  input: FulfillByReferenceInput,
): Promise<FulfillByReferenceOutcome> {
  const { repo } = deps;
  if (!input.actorUserId) throw new ReleaseError("Fulfilling by reference requires a named approver.");

  const [agency, request, doc, actor] = await Promise.all([
    repo.getAgency(input.agencyId),
    repo.getRequest(input.agencyId, input.requestId),
    repo.getDocument(input.agencyId, input.documentId),
    repo.getUser(input.agencyId, input.actorUserId),
  ]);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  if (!doc) throw new NotFoundError("Document", input.documentId);
  if (doc.classification !== "public") {
    // The whole premise is "already released". A non-public document has NOT
    // been reviewed for release — refusing here keeps this path honest.
    throw new ReleaseError("Only an already-public record can answer a request by reference.");
  }
  assertTransition(request.status, "fulfilled"); // throws before anything is written

  const requester = request.requesterId
    ? await repo.getRequester(input.agencyId, request.requesterId)
    : null;

  const baseUrl = deps.baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
  const meta = (doc.metadata ?? {}) as { title?: string };
  const title = meta.title ?? doc.filename ?? "the released record";
  const permalink = `${baseUrl}/${agency.slug}/archive/${doc.id}`;

  const letter = [
    `Hi ${requester?.name ?? "there"},`,
    ``,
    `Good news about your request (${request.publicId}): the records you asked for`,
    `are already public. ${agency.name} released them previously, and they're`,
    `available right now — no waiting on us.`,
    ``,
    input.note ? `${input.note}\n` : ``,
    `  ${title}`,
    `  ${permalink}`,
    ``,
    `That link is permanent and shareable. We're closing ${request.publicId} as`,
    `fulfilled. If the record doesn't fully answer what you were after, just`,
    `reply and we'll reopen the conversation.`,
    ``,
    `— ${agency.name} records office`,
  ]
    .filter((l) => l !== ``)
    .join("\n");

  const now = deps.now();
  // The letter first (threaded + delivered via the outbox, named sender);
  // sendStaffMessage validates the body and actor.
  await sendStaffMessage(deps, {
    agencyId: input.agencyId,
    requestId: request.id,
    actorUserId: input.actorUserId,
    subject: `${agency.name}: your request ${request.publicId} — records already available`,
    body: letter,
  });

  const updated = await repo.updateRequest(input.agencyId, request.id, {
    status: "fulfilled",
    closedAt: now,
  });
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "status_change",
    actorUserId: input.actorUserId,
    summary: `Fulfilled by reference to already-public record by ${actor.name ?? actor.email}`,
    payload: { from: request.status, to: "fulfilled", byReference: true, documentId: doc.id },
    createdAt: now,
  });

  // The ROI number: production avoided because the archive already had it.
  const { logDeflection } = await import("./deflectionService");
  await logDeflection(deps, {
    agencyId: input.agencyId,
    kind: "answered_by_link",
    query: request.interpretedScope ?? request.rawText,
    documentId: doc.id,
  });

  {
    const { emitStatusWebhook } = await import("./statusApiService");
    await emitStatusWebhook(deps, {
      agencyId: input.agencyId,
      publicId: request.publicId,
      event: "status_changed",
      to: "fulfilled",
    });
  }

  return { request: updated, letter, requesterNotified: requester?.email != null };
}
