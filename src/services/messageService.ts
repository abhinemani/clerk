/**
 * Requester correspondence (spec §5 messages, §6.6, §10).
 *
 * The clarification loop: staff write to the requester (optionally pausing the
 * request in `clarification_needed`), the requester replies from the portal,
 * and the reply puts the request back in front of staff (`in_review`).
 *
 * Invariants enforced here:
 *  - No outbound message without a named human (`sentByUserId`) — AI may draft,
 *    only staff send (§10). The `aiDrafted` flag + prompt version ride along
 *    for the audit trail.
 *  - Every message appends a `message` RequestEvent (append-only, §5).
 *  - Outbound portal messages also land in the outbox (deliveries) when the
 *    requester has an email — the audit of who was told what.
 *  - Internal notes never notify and are never shown to the requester.
 */
import { canTransition } from "@/domain/requestLifecycle";
import type { ServiceDeps } from "./deps";
import { inboundAddress } from "./notifications";
import { NotFoundError, type MessageEntity } from "./repository";
import { transitionRequest } from "./requestService";

export class MessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageError";
  }
}

export interface SendStaffMessageInput {
  agencyId: string;
  requestId: string;
  /** The named human sending (or approving) this message — required (§10). */
  actorUserId: string;
  subject?: string;
  body: string;
  /** True when the body came from the §6.6 correspondence pipeline. */
  aiDrafted?: boolean;
  /** Provenance for AI-drafted bodies, logged in the audit event. */
  aiMeta?: { promptVersion: string; model: string };
  /** Internal note: visible to staff only, no delivery, no status change. */
  internal?: boolean;
  /** Also move the request to `clarification_needed` (must be legal). */
  requestClarification?: boolean;
}

/** Staff → requester message (or internal note), with audit + outbox delivery. */
export async function sendStaffMessage(
  deps: ServiceDeps,
  input: SendStaffMessageInput,
): Promise<MessageEntity> {
  const { repo } = deps;
  const body = input.body?.trim() ?? "";
  if (!body) throw new MessageError("The message body is empty.");
  if (!input.actorUserId) throw new MessageError("Outbound messages require a named sender.");

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  // Validate the clarification transition up front — nothing is written if the
  // request can no longer be paused for clarification.
  if (input.requestClarification && !canTransition(request.status, "clarification_needed")) {
    throw new MessageError(
      `Can't mark a ${request.status} request as needing clarification.`,
    );
  }

  const at = deps.now();
  const message = await repo.createMessage({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    direction: input.internal ? "internal_note" : "outbound",
    channel: "portal",
    subject: input.subject?.trim() || null,
    body,
    aiDrafted: input.aiDrafted ?? false,
    sentByUserId: input.actorUserId,
    sentAt: at,
    createdAt: at,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "message",
    actorUserId: input.actorUserId,
    summary: input.internal ? "Internal note added" : "Message sent to requester",
    payload: {
      messageId: message.id,
      direction: message.direction,
      subject: message.subject,
      aiDrafted: message.aiDrafted,
      ...(input.aiMeta ? { promptVersion: input.aiMeta.promptVersion, model: input.aiMeta.model } : {}),
    },
    createdAt: at,
  });

  // Deliver to the requester's inbox (outbox in dev) — internal notes never leave.
  if (!input.internal && deps.notifier && request.requesterId) {
    const requester = await repo.getRequester(input.agencyId, request.requesterId);
    if (requester?.email) {
      const agency = await repo.getAgency(input.agencyId);
      const base = deps.baseUrl ?? "http://localhost:3000";
      const trackLink = agency ? `${base}/${agency.slug}/track?id=${request.publicId}` : null;
      await deps.notifier.send({
        agencyId: input.agencyId,
        to: requester.email,
        subject: message.subject ?? `Update on your records request ${request.publicId}`,
        body: [body, ...(trackLink ? [``, `View and reply: ${trackLink}`] : [])].join("\n"),
        kind: "requester_update",
        requestId: request.id,
        // Replying to this email lands back on the request's thread (§6.5).
        replyTo: inboundAddress("request", request.id),
      });
    }
  }

  if (input.requestClarification) {
    await transitionRequest(deps, {
      agencyId: input.agencyId,
      requestId: request.id,
      to: "clarification_needed",
      actorUserId: input.actorUserId,
      note: "Waiting on the requester's reply",
    });
  }

  return message;
}

export interface PostRequesterReplyInput {
  agencyId: string;
  requestId: string;
  /** The authenticated requester posting the reply — must own the request. */
  requesterId: string;
  body: string;
}

/**
 * Requester → staff reply from the portal. Ownership is enforced here (never
 * trusted from the client), and a reply to a request paused in
 * `clarification_needed` puts it back in front of staff.
 */
export async function postRequesterReply(
  deps: ServiceDeps,
  input: PostRequesterReplyInput,
): Promise<MessageEntity> {
  const { repo } = deps;
  const body = input.body?.trim() ?? "";
  if (!body) throw new MessageError("The message body is empty.");

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (!request.requesterId || request.requesterId !== input.requesterId) {
    throw new MessageError("This request doesn't belong to your account.");
  }

  const at = deps.now();
  const message = await repo.createMessage({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    direction: "inbound",
    channel: "portal",
    subject: null,
    body,
    aiDrafted: false,
    sentByUserId: null,
    sentAt: at,
    createdAt: at,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "message",
    actorUserId: null,
    summary: "Requester replied",
    payload: { messageId: message.id, direction: "inbound" },
    createdAt: at,
  });

  // The answer staff were waiting on — resume the review.
  if (request.status === "clarification_needed") {
    await transitionRequest(deps, {
      agencyId: input.agencyId,
      requestId: request.id,
      to: "in_review",
      actorUserId: undefined,
      note: "Requester replied",
    });
  }

  return message;
}
