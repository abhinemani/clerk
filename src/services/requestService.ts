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
import { effectiveWorkflowSettings, isAssignableRole, pickCoordinator } from "@/domain/workflow";
import type { ServiceDeps } from "./deps";
import {
  milestoneInProgressBody,
  milestoneReceivedBody,
  trackUrl,
} from "./notifications";
import { NotFoundError, type Agency, type RequestEntity, type RequesterType } from "./repository";

/**
 * Template-only requester milestone email (no black hole between filing and
 * outcome). Outbox-first via the notifier; recorded as a delivery event.
 * No-ops without a notifier, a requester email, or with the agency opted out.
 */
async function sendMilestoneEmail(
  deps: ServiceDeps,
  input: {
    agency: Agency;
    request: RequestEntity;
    milestone: "received" | "in_progress";
  },
): Promise<void> {
  if (!deps.notifier) return;
  if (!effectiveWorkflowSettings(input.agency.workflowSettings).milestoneEmails) return;
  const requester = input.request.requesterId
    ? await deps.repo.getRequester(input.agency.id, input.request.requesterId)
    : null;
  if (!requester?.email) return; // anonymous filings track via the number

  const dueLabel = input.request.statutoryDueAt
    ? isoDate(input.request.statutoryDueAt)
    : null;
  const template = input.milestone === "received" ? milestoneReceivedBody : milestoneInProgressBody;
  const { subject, body } = template({
    agencyName: input.agency.name,
    requesterName: requester.name,
    publicId: input.request.publicId,
    dueLabel,
    link: trackUrl(input.agency.slug, input.request.publicId, deps.baseUrl),
  });
  const receipt = await deps.notifier.send({
    agencyId: input.agency.id,
    to: requester.email,
    subject,
    body,
    kind: "requester_update",
    requestId: input.request.id,
  });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agency.id,
    requestId: input.request.id,
    kind: "delivery",
    actorUserId: null,
    summary: `Milestone email (${input.milestone === "received" ? "request received" : "work started"}) sent to the requester`,
    payload: { milestone: input.milestone, to: requester.email, channel: receipt.channel, deliveryId: receipt.id },
    createdAt: deps.now(),
  });
}

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

  // Milestone 1 of "no black hole": confirm receipt with the tracking number
  // and statutory deadline. Advisory — a notify failure never blocks filing.
  try {
    await sendMilestoneEmail(deps, { agency, request, milestone: "received" });
  } catch (e) {
    console.error("received-milestone email failed", e);
  }

  // Status webhook (opt-in per agency, never blocking): the subscriber's ping.
  const { emitStatusWebhook } = await import("./statusApiService");
  await emitStatusWebhook(deps, {
    agencyId: agency.id,
    publicId,
    event: "status_changed",
    to: "submitted",
  });

  // Ask vector (answer-first phase 4): written at the moment of filing so
  // this request joins the precedent corpus for every later one. Best-effort
  // inside writeRequestEmbedding — an embedding provider being down must
  // never be the reason a request cannot be filed.
  const { writeRequestEmbedding } = await import("./similarRequestsService");
  await writeRequestEmbedding(deps, { agencyId: agency.id, requestId: request.id });

  // Opt-in auto-assignment (src/domain/workflow.ts): load-balance the new
  // request across coordinators so no single person routes the whole queue.
  // Internal workflow only — deterministic, evented, reassignable in the UI.
  const workflow = effectiveWorkflowSettings(agency.workflowSettings);
  if (workflow.autoAssign) {
    const [staff, open] = await Promise.all([repo.listUsers(agency.id), repo.listRequests(agency.id)]);
    const openByUser = new Map<string, number>();
    for (const r of open) {
      if (r.closedAt == null && r.assignedCoordinatorId) {
        openByUser.set(r.assignedCoordinatorId, (openByUser.get(r.assignedCoordinatorId) ?? 0) + 1);
      }
    }
    const chosen = pickCoordinator(
      staff
        .filter((u) => isAssignableRole(u.role))
        .map((u) => ({ userId: u.id, openAssigned: openByUser.get(u.id) ?? 0 })),
    );
    if (chosen) {
      const assignee = staff.find((u) => u.id === chosen)!;
      await repo.updateRequest(agency.id, request.id, { assignedCoordinatorId: chosen });
      request.assignedCoordinatorId = chosen;
      await repo.appendEvent({
        id: deps.genId(),
        agencyId: agency.id,
        requestId: request.id,
        kind: "assignment",
        actorUserId: null,
        summary: `Auto-assigned to ${assignee.name ?? assignee.email} (least-loaded coordinator)`,
        payload: { assignedCoordinatorId: chosen, auto: true },
        createdAt: deps.now(),
      });
    }
  }

  return request;
}

export interface AssignCoordinatorInput {
  agencyId: string;
  requestId: string;
  /** New owner, or null to unassign. */
  coordinatorUserId: string | null;
  /** The staff member making the change (named in the event). */
  actorUserId: string;
}

/** Manual (re)assignment from the workspace — the human override for auto-assign. */
export async function assignCoordinator(
  deps: ServiceDeps,
  input: AssignCoordinatorInput,
): Promise<RequestEntity> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  let assigneeLabel = "unassigned";
  if (input.coordinatorUserId) {
    const assignee = await repo.getUser(input.agencyId, input.coordinatorUserId);
    if (!assignee) throw new NotFoundError("User", input.coordinatorUserId);
    if (!isAssignableRole(assignee.role)) {
      throw new Error(`${assignee.name ?? assignee.email} cannot own requests (role: ${assignee.role}).`);
    }
    assigneeLabel = assignee.name ?? assignee.email;
  }

  const updated = await repo.updateRequest(input.agencyId, request.id, {
    assignedCoordinatorId: input.coordinatorUserId,
  });
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "assignment",
    actorUserId: input.actorUserId,
    summary: `Request assigned to ${assigneeLabel}`,
    payload: { assignedCoordinatorId: input.coordinatorUserId, auto: false },
    createdAt: deps.now(),
  });
  return updated;
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

  // Milestone 2 of "no black hole": tell the requester when work actually
  // starts. Only this transition — outcome mail (release/denial letters) and
  // extension notices already have their own flows.
  if (input.to === "in_progress") {
    try {
      const agency = await repo.getAgency(input.agencyId);
      if (agency) await sendMilestoneEmail(deps, { agency, request: updated, milestone: "in_progress" });
    } catch (e) {
      console.error("in_progress-milestone email failed", e);
    }
  }

  const { emitStatusWebhook } = await import("./statusApiService");
  await emitStatusWebhook(deps, {
    agencyId: input.agencyId,
    publicId: request.publicId,
    event: "status_changed",
    to: input.to,
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

  {
    const { emitStatusWebhook } = await import("./statusApiService");
    await emitStatusWebhook(deps, {
      agencyId: input.agencyId,
      publicId: request.publicId,
      event: "deadline_extended",
      dueAt: computed.dueAt,
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
    /** Phase 4: which resolved precedents the model saw (audit trail). */
    precedentPublicIds?: string[];
    /** Learning-loop v2: the matched play whose stats rode the prompt. */
    playTopic?: string;
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
      // A grounded draft cites its grounding, like every other AI artifact.
      ...(input.precedentPublicIds?.length ? { precedents: input.precedentPublicIds } : {}),
      ...(input.playTopic ? { playContext: input.playTopic } : {}),
    },
    createdAt: at,
  });

  return updated;
}

/**
 * "Lost your tracking number?" — the anonymous requester's recovery path.
 * Deliberately silent about whether the email is known (same no-enumeration
 * rule as password reset): the response is identical either way, and the
 * list of tracking numbers only ever travels TO the address the requests
 * were filed under.
 */
export async function sendTrackingReminder(
  deps: ServiceDeps,
  input: { agencyId: string; email: string; trackLinkBase: string },
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) return;
  const requester = await deps.repo.findRequesterByEmail(input.agencyId, email);
  if (!requester) return; // same outward behavior as success
  const requests = await deps.repo.listRequestsByRequester(input.agencyId, requester.id);
  if (requests.length === 0) return;

  const newest = [...requests]
    .sort((a, b) => (b.receivedAt ?? b.createdAt).getTime() - (a.receivedAt ?? a.createdAt).getTime())
    .slice(0, 5);
  const lines = newest.map(
    (r) =>
      `  ${r.publicId} — filed ${(r.receivedAt ?? r.createdAt).toISOString().slice(0, 10)} · ${r.status.replace(/_/g, " ")}\n  ${input.trackLinkBase}?id=${encodeURIComponent(r.publicId)}`,
  );
  await deps.notifier?.send({
    agencyId: input.agencyId,
    to: email,
    subject: "Your records request tracking numbers",
    body: [
      `You asked for the tracking numbers of requests filed with this email address:`,
      ``,
      ...lines,
      ``,
      `If this wasn't you, you can ignore this message.`,
    ].join("\n"),
    kind: "requester_update",
  });
}
