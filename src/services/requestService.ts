/**
 * Request use cases (spec §5, §6.1, §7, §10).
 *
 * These orchestrate the domain: create a requester (deduped), mint a public id,
 * compute the statutory deadline from the agency's statute profile, persist the
 * request, and append the audit events that make the request defensible. All
 * status changes go through the lifecycle state machine — an illegal jump throws.
 */
import { computeDueDate } from "@/statute/computeDueDate";
import { getStateProfile } from "@/statute/profiles";
import { formatPublicId } from "@/domain/publicId";
import { assertTransition, type RequestStatus } from "@/domain/requestLifecycle";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type RequestEntity, type RequesterType } from "./repository";

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
    payload: { pipeline: "intake_triage", promptVersion: input.promptVersion, model: input.model },
    createdAt: at,
  });

  return updated;
}
