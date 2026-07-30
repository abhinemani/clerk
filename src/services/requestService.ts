/**
 * Request use cases (spec §5, §6.1, §7, §10).
 *
 * These orchestrate the domain: create a requester (deduped), mint a public id,
 * compute the statutory deadline from the agency's statute profile, persist the
 * request, and append the audit events that make the request defensible. All
 * status changes go through the lifecycle state machine — an illegal jump throws.
 */
import { computeDueDate, isoDate } from "@/statute/computeDueDate";
import { getStateProfile } from "@/statute/profiles";
import { composeExtensionNotice } from "@/domain/extensionNotice";
import { formatPublicId } from "@/domain/publicId";
import { assertTransition, type RequestStatus } from "@/domain/requestLifecycle";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type RequestEntity, type RequesterType } from "./repository";

export class ExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtensionError";
  }
}

export interface SubmitRequestInput {
  agencyId: string;
  rawText: string;
  requester?: { email?: string; name?: string; type?: RequesterType };
}

/**
 * Submit a new public-records request through the portal. Creates the request in
 * `submitted`, computes its statutory due date, and logs the intake events.
 */
export async function submitRequest(
  deps: ServiceDeps,
  input: SubmitRequestInput,
): Promise<RequestEntity> {
  const { repo } = deps;
  const agency = await repo.getAgency(input.agencyId);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);

  // Requester: dedupe by email within the agency; anonymous otherwise.
  const email = input.requester?.email?.trim() || null;
  let requesterId: string | null = null;
  if (email) {
    const existing = await repo.findRequesterByEmail(agency.id, email);
    requesterId =
      existing?.id ??
      (
        await repo.createRequester({
          id: deps.genId(),
          agencyId: agency.id,
          email,
          name: input.requester?.name ?? null,
          type: input.requester?.type ?? "individual",
        })
      ).id;
  } else if (input.requester?.name) {
    requesterId = (
      await repo.createRequester({
        id: deps.genId(),
        agencyId: agency.id,
        email: null,
        name: input.requester.name,
        type: input.requester.type ?? "anonymous",
      })
    ).id;
  }

  const receivedAt = deps.now();

  // Statutory deadline from the agency's state profile (§7).
  let statutoryDueAt: Date | null = null;
  let dueBasis = "No statute profile configured for state; deadline not computed.";
  const profile = getStateProfile(agency.stateCode);
  if (profile) {
    const due = computeDueDate({
      receivedAt,
      clock: profile.responseClock,
      holidays: agency.observedHolidays,
    });
    statutoryDueAt = due.dueAt;
    dueBasis = due.basis;
  }

  const year = receivedAt.getUTCFullYear();
  const seq = await repo.nextPublicIdSeq(agency.id, year);
  const publicId = formatPublicId(year, seq);

  const request = await repo.createRequest({
    id: deps.genId(),
    agencyId: agency.id,
    publicId,
    requesterId,
    status: "submitted",
    rawText: input.rawText,
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt,
    statutoryDueAt,
    closedAt: null,
    createdAt: receivedAt,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: agency.id,
    requestId: request.id,
    kind: "status_change",
    actorUserId: null,
    summary: `Request submitted as ${publicId}`,
    payload: { to: "submitted", dueBasis, statutoryDueAt: statutoryDueAt?.toISOString() ?? null },
    createdAt: receivedAt,
  });

  return request;
}

export interface TransitionRequestInput {
  agencyId: string;
  requestId: string;
  to: RequestStatus;
  actorUserId?: string;
  note?: string;
}

/** Move a request to a new status, enforcing the lifecycle graph and logging it. */
export async function transitionRequest(
  deps: ServiceDeps,
  input: TransitionRequestInput,
): Promise<RequestEntity> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  assertTransition(request.status, input.to); // throws on illegal jump
  const at = deps.now();
  const updated = await repo.updateRequest(input.agencyId, request.id, { status: input.to });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "status_change",
    actorUserId: input.actorUserId ?? null,
    summary: `Status ${request.status} → ${input.to}`,
    payload: { from: request.status, to: input.to, note: input.note },
    createdAt: at,
  });

  return updated;
}

/**
 * A named human accepts (possibly after editing) the triage draft — the
 * "dispose" half of accept/edit/dismiss (§6.1, §8). Persists the scope and
 * moves a fresh request into review.
 */
export async function approveTriage(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    requestId: string;
    actorUserId: string;
    interpretedScope: string;
    recordTypes: string[];
    complexityScore?: number;
  },
): Promise<RequestEntity> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  let updated = await repo.updateRequest(input.agencyId, request.id, {
    interpretedScope: input.interpretedScope,
    recordTypes: input.recordTypes,
    ...(input.complexityScore != null ? { complexityScore: input.complexityScore } : {}),
  });
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "approval",
    actorUserId: input.actorUserId,
    summary: "Coordinator accepted the triage scope",
    payload: { interpretedScope: input.interpretedScope, recordTypes: input.recordTypes },
    createdAt: deps.now(),
  });
  if (request.status === "submitted") {
    updated = await transitionRequest(deps, {
      agencyId: input.agencyId,
      requestId: request.id,
      to: "in_review",
      actorUserId: input.actorUserId,
      note: "Triage accepted",
    });
  }
  return updated;
}

export interface ExtendRequestInput {
  agencyId: string;
  requestId: string;
  /** The named human taking the extension (invariant 4). */
  actorUserId: string;
  days: number;
  /** Must be one of the statute's permitted reasons (§7). */
  reason: string;
  /** Optional specifics for the notice letter. */
  note?: string;
}

export interface ExtendOutcome {
  request: RequestEntity;
  newDueAt: Date;
  basis: string;
  noticeSent: boolean;
}

/**
 * Take the statutory extension (§7): validated against the state profile's
 * extension rules, the new deadline computed by the same pure function that
 * set the original (and logged with its basis — invariant 7), and the §6.6
 * notice delivered to the requester through the correspondence thread.
 * One extension per request — the common statutory shape ("may extend once").
 */
export async function extendRequest(deps: ServiceDeps, input: ExtendRequestInput): Promise<ExtendOutcome> {
  const { repo } = deps;
  if (!input.actorUserId) throw new ExtensionError("An extension requires a named staff member.");

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (request.closedAt != null) throw new ExtensionError("This request is closed — nothing to extend.");
  if (!request.receivedAt || !request.statutoryDueAt) {
    throw new ExtensionError("This request has no computed statutory deadline to extend.");
  }
  if ((request.extensionHistory ?? []).length > 0) {
    throw new ExtensionError("The statutory extension has already been taken for this request.");
  }

  const agency = await repo.getAgency(input.agencyId);
  const profile = agency ? getStateProfile(agency.stateCode) : null;
  if (!profile) throw new ExtensionError("No statute profile configured for this agency's state.");
  const extConfig = profile.responseClock.extension;
  if (!extConfig.allowed) throw new ExtensionError("This statute does not permit extensions.");
  if (!extConfig.permittedReasons.includes(input.reason)) {
    throw new ExtensionError(
      `"${input.reason}" is not a permitted extension reason for ${profile.stateName}.`,
    );
  }

  // Recompute the whole deadline chain from receipt — same pure function,
  // same holidays, now with the extension. Throws on days out of range.
  let computed: ReturnType<typeof computeDueDate>;
  try {
    computed = computeDueDate({
      receivedAt: request.receivedAt,
      clock: profile.responseClock,
      holidays: agency!.observedHolidays,
      extension: { days: input.days, reason: input.reason },
    });
  } catch (e) {
    throw new ExtensionError(e instanceof Error ? e.message : "Invalid extension.");
  }

  const at = deps.now();
  const priorDueAt = request.statutoryDueAt;
  const updated = await repo.updateRequest(input.agencyId, request.id, {
    statutoryDueAt: computed.dueAt,
    extensionHistory: [
      ...(request.extensionHistory ?? []),
      {
        at: at.toISOString(),
        byUserId: input.actorUserId,
        days: input.days,
        reason: input.reason,
        statutoryBasis: computed.basis,
      },
    ],
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "extension",
    actorUserId: input.actorUserId,
    summary: `Deadline extended ${input.days} ${extConfig.dayType} day(s) — now due ${isoDate(computed.dueAt)}`,
    payload: {
      days: input.days,
      dayType: extConfig.dayType,
      reason: input.reason,
      from: isoDate(priorDueAt),
      to: isoDate(computed.dueAt),
      basis: computed.basis, // invariant 7: the deadline persists with its basis
    },
    createdAt: at,
  });

  // Statutory notice (§6.6) — through the thread + outbox, like every letter.
  let noticeSent = false;
  const requester = request.requesterId
    ? await repo.getRequester(input.agencyId, request.requesterId)
    : null;
  if (requester?.email) {
    const { sendStaffMessage } = await import("./messageService");
    await sendStaffMessage(deps, {
      agencyId: input.agencyId,
      requestId: request.id,
      actorUserId: input.actorUserId,
      subject: `Response date update for your records request ${request.publicId}`,
      body: composeExtensionNotice({
        publicId: request.publicId,
        agencyName: agency!.name,
        requesterName: requester.name,
        requestSummary: request.interpretedScope ?? request.rawText,
        days: input.days,
        dayType: extConfig.dayType,
        reason: input.reason,
        priorDueDate: isoDate(priorDueAt),
        newDueDate: isoDate(computed.dueAt),
        note: input.note,
      }),
    });
    noticeSent = true;
  } else if (extConfig.noticeRequired) {
    // The statute requires notice and we can't deliver one — leave a loud trace.
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      kind: "note",
      actorUserId: input.actorUserId,
      summary: "Extension notice required but the requester has no email on file",
      payload: { reason: input.reason },
      createdAt: deps.now(),
    });
  }

  return { request: updated, newDueAt: computed.dueAt, basis: computed.basis, noticeSent };
}

/** Attach an AI triage draft to a request (§6.1) — staff still review/dispose. */
export async function applyTriageDraft(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    requestId: string;
    interpretedScope: string;
    recordTypes: string[];
    complexityScore: number;
    promptVersion: string;
    model: string;
    /** Statutory red flags surfaced by the pipeline (recorded for the audit log). */
    redFlags?: string[];
  },
): Promise<RequestEntity> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  const at = deps.now();
  const updated = await repo.updateRequest(input.agencyId, request.id, {
    interpretedScope: input.interpretedScope,
    recordTypes: input.recordTypes,
    complexityScore: input.complexityScore,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "ai_action",
    actorUserId: null,
    summary: "Intake triage draft applied",
    payload: {
      pipeline: "intake_triage",
      promptVersion: input.promptVersion,
      model: input.model,
      redFlags: input.redFlags ?? [],
    },
    createdAt: at,
  });

  return updated;
}
