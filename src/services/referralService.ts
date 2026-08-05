/**
 * Inter-agency referral — the "wrong custodian" outcome.
 *
 * The failure this fixes: a resident asks the city for a school district
 * record. Today most portals close it as "no responsive records," and the
 * resident starts over from zero — re-explaining, re-filing, waiting the full
 * clock again. Most state PRAs actually require an agency to help identify who
 * holds the record, so this is a compliance obligation, not a courtesy.
 *
 * A referral is deliberately NOT a denial: denying means we held records and
 * withheld them. Conflating the two corrupts the denial rate an agency
 * publishes, and makes an office look secretive when it was being helpful.
 */
import { assertTransition } from "@/domain/requestLifecycle";
import type { ServiceDeps } from "./deps";
import {
  NotFoundError,
  type DirectoryEntry,
  type ForwardLink,
  type RequestEntity,
} from "./repository";
import { trackUrl } from "./notifications";
import { submitRequest } from "./requestService";

export class ReferralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralError";
  }
}

export interface ReferRequestInput {
  agencyId: string;
  requestId: string;
  /** Directory entry to point the requester at. */
  directoryEntryId: string;
  /** Named human making the referral (invariant 4 — this reaches a requester). */
  actorUserId: string;
  /** Optional staff note added to the letter. */
  note?: string;
  /** Also email the receiving agency, when we have an address for them. */
  notifyTargetAgency?: boolean;
}

/** The letter a requester gets — plain, actionable, with their text to reuse. */
export function composeReferralLetter(input: {
  agencyName: string;
  publicId: string;
  requesterName?: string | null;
  target: DirectoryEntry;
  rawText: string;
  note?: string;
}): { subject: string; body: string } {
  const t = input.target;
  const contact = [
    t.contactEmail ? `Email: ${t.contactEmail}` : "",
    t.contactPhone ? `Phone: ${t.contactPhone}` : "",
    t.portalUrl ? `Records portal: ${t.portalUrl}` : "",
  ].filter(Boolean);

  return {
    subject: `${input.agencyName}: your request ${input.publicId} — records held by ${t.name}`,
    body: [
      `Hi ${input.requesterName ?? "there"},`,
      ``,
      `We reviewed your request (${input.publicId}) and the records you're asking for`,
      `aren't held by ${input.agencyName} — they're maintained by ${t.name}.`,
      ``,
      input.note ? `${input.note}\n` : ``,
      `How to reach them:`,
      ...contact.map((c) => `  ${c}`),
      contact.length === 0 ? `  (We don't have contact details on file — please search for ${t.name}.)` : ``,
      ``,
      `So you don't have to write it again, here is your request as you filed it:`,
      ``,
      ...input.rawText.split("\n").map((l) => `  ${l}`),
      ``,
      `We've closed ${input.publicId} on our side as referred — not denied. If you`,
      `believe we do hold these records after all, reply and we'll take another look.`,
      ``,
      `— ${input.agencyName} records office`,
    ]
      .filter((l) => l !== ``)
      .join("\n"),
  };
}

export interface ReferralOutcome {
  request: RequestEntity;
  target: DirectoryEntry;
  requesterNotified: boolean;
  targetNotified: boolean;
}

export async function referRequest(
  deps: ServiceDeps,
  input: ReferRequestInput,
): Promise<ReferralOutcome> {
  const { repo } = deps;
  const [agency, request, target, actor] = await Promise.all([
    repo.getAgency(input.agencyId),
    repo.getRequest(input.agencyId, input.requestId),
    repo.getDirectoryEntry(input.agencyId, input.directoryEntryId),
    repo.getUser(input.agencyId, input.actorUserId),
  ]);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (!target) throw new NotFoundError("DirectoryEntry", input.directoryEntryId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  if (request.closedAt != null) throw new ReferralError("This request is already closed.");

  // The lifecycle decides whether a referral is legal from here.
  assertTransition(request.status, "referred");

  const at = deps.now();
  const requester = request.requesterId
    ? await repo.getRequester(input.agencyId, request.requesterId)
    : null;

  const letter = composeReferralLetter({
    agencyName: agency.name,
    publicId: request.publicId,
    requesterName: requester?.name,
    target,
    rawText: request.rawText, // immutable original (invariant 6)
    note: input.note,
  });

  // Close as referred — the statutory clock stops, like any other outcome.
  const updated = await repo.updateRequest(input.agencyId, request.id, {
    status: "referred",
    referredToDirectoryId: target.id,
    referredAt: at,
    closedAt: at,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "status_change",
    actorUserId: input.actorUserId,
    summary: `Referred to ${target.name} by ${actor.name ?? actor.email}`,
    payload: {
      from: request.status,
      to: "referred",
      directoryEntryId: target.id,
      targetName: target.name,
      note: input.note ?? null,
    },
    createdAt: at,
  });

  // Tell the requester where to go. Recorded in the correspondence thread so
  // it lives with the rest of the conversation, and delivered via the outbox.
  let requesterNotified = false;
  if (requester?.email && deps.notifier) {
    const receipt = await deps.notifier.send({
      agencyId: input.agencyId,
      to: requester.email,
      subject: letter.subject,
      body: letter.body,
      kind: "requester_update",
      requestId: request.id,
    });
    await repo.createMessage({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      direction: "outbound",
      channel: "email",
      subject: letter.subject,
      body: letter.body,
      aiDrafted: false,
      sentByUserId: input.actorUserId, // named human on anything requester-facing
      sentAt: at,
      createdAt: at,
    });
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      kind: "delivery",
      actorUserId: input.actorUserId,
      summary: `Referral letter sent to ${requester.email}`,
      payload: { to: requester.email, channel: receipt.channel, deliveryId: receipt.id },
      createdAt: at,
    });
    requesterNotified = true;
  }

  // Optionally give the receiving agency a heads-up. Never includes anything
  // beyond what the requester already wrote.
  let targetNotified = false;
  if (input.notifyTargetAgency && target.contactEmail && deps.notifier) {
    const receipt = await deps.notifier.send({
      agencyId: input.agencyId,
      to: target.contactEmail,
      subject: `Records request referred from ${agency.name} (${request.publicId})`,
      body: [
        `Colleagues,`,
        ``,
        `A resident asked ${agency.name} for records we believe ${target.name} holds.`,
        `We've pointed them to you and closed our file as referred.`,
        ``,
        `Their request, as filed:`,
        ``,
        ...request.rawText.split("\n").map((l) => `  ${l}`),
        ``,
        requester?.email ? `They can be reached at ${requester.email}.` : `They filed anonymously.`,
        ``,
        `— ${agency.name} records office`,
      ].join("\n"),
      kind: "requester_update",
      requestId: request.id,
    });
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      kind: "delivery",
      actorUserId: input.actorUserId,
      summary: `Referral notice sent to ${target.name} (${target.contactEmail})`,
      payload: { to: target.contactEmail, channel: receipt.channel, deliveryId: receipt.id },
      createdAt: at,
    });
    targetNotified = true;
  }

  return { request: updated, target, requesterNotified, targetNotified };
}

// ---------------------------------------------------------------------------
// Phase 3 — cross-tenant forwarding (docs/inter-agency-referral.md).
//
// THE ONE PLACE THAT CROSSES TENANTS. Every other read and write in this repo
// is scoped to a single agency, on purpose (invariant 2). Forwarding is the
// single operation that legitimately touches two, so all of it lives behind
// this one function, the crossing is explicit in its signature (source agency
// in the input, target agency resolved from the directory entry's
// peerAgencyId), and the data that crosses is a hard allow-list:
//
//   ALLOWED  : rawText (verbatim — invariant 6), and WITH per-forward consent
//              (owner decision 2026-08-04: checkbox, default OFF) the
//              requester's name/email/type.
//   FORBIDDEN: documents, events, internal notes, staff identities, scope
//              interpretations, everything else.
//
// The tenant-isolation suite pins this allow-list with a test; widening it is
// a product/legal decision, not a refactor.
// ---------------------------------------------------------------------------

export interface ForwardRequestInput {
  agencyId: string;
  requestId: string;
  /** Directory entry to forward to — must be linked to a peer tenant. */
  directoryEntryId: string;
  /** Named human forwarding (invariant 4 — this closes a request and writes to a resident). */
  actorUserId: string;
  /** Optional staff note added to the requester's letter. */
  note?: string;
  /**
   * Consent to share the requester's name + email with the receiving agency
   * so they can reply directly. DEFAULT FALSE: without it only the request
   * text crosses, and the new request is anonymous at the target.
   */
  shareContact?: boolean;
}

/** The letter the requester gets when their request is forwarded for them. */
export function composeForwardingLetter(input: {
  agencyName: string;
  publicId: string;
  requesterName?: string | null;
  targetAgencyName: string;
  targetPublicId: string;
  targetTrackLink: string;
  sharedContact: boolean;
  note?: string;
}): { subject: string; body: string } {
  return {
    subject: `${input.agencyName}: your request ${input.publicId} — forwarded to ${input.targetAgencyName}`,
    body: [
      `Hi ${input.requesterName ?? "there"},`,
      ``,
      `We reviewed your request (${input.publicId}) and the records you're asking for`,
      `are held by ${input.targetAgencyName}, not ${input.agencyName}.`,
      ``,
      input.note ? `${input.note}\n` : ``,
      `Good news: ${input.targetAgencyName} uses the same records system, so we've`,
      `re-filed your request with them for you — you don't need to write it again.`,
      ``,
      `Their tracking number: ${input.targetPublicId}`,
      `Follow it here: ${input.targetTrackLink}`,
      ``,
      input.sharedContact
        ? `We shared your contact details with them (as you agreed via our office), so`
        : `We did NOT share your contact details with them — only your request text. To`,
      input.sharedContact
        ? `they can reply to you directly.`
        : `hear back directly, add your email on their tracking page or contact them.`,
      ``,
      `We've closed ${input.publicId} on our side as referred — not denied. If you`,
      `believe we do hold these records after all, reply and we'll take another look.`,
      ``,
      `— ${input.agencyName} records office`,
    ]
      .filter((l) => l !== ``)
      .join("\n"),
  };
}

export interface ForwardOutcome {
  request: RequestEntity;
  /** The newly created request in the TARGET tenant. */
  forwarded: RequestEntity;
  target: DirectoryEntry;
  requesterNotified: boolean;
}

export async function forwardRequest(
  deps: ServiceDeps,
  input: ForwardRequestInput,
): Promise<ForwardOutcome> {
  const { repo } = deps;
  const [agency, request, target, actor] = await Promise.all([
    repo.getAgency(input.agencyId),
    repo.getRequest(input.agencyId, input.requestId),
    repo.getDirectoryEntry(input.agencyId, input.directoryEntryId),
    repo.getUser(input.agencyId, input.actorUserId),
  ]);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (!target) throw new NotFoundError("DirectoryEntry", input.directoryEntryId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  if (!target.peerAgencyId) {
    throw new ReferralError(`${target.name} is not linked to a Clerk tenant — use Refer instead.`);
  }
  if (target.peerAgencyId === input.agencyId) {
    throw new ReferralError("A request cannot be forwarded to its own agency.");
  }
  if (request.closedAt != null) throw new ReferralError("This request is already closed.");
  // Validate the source transition BEFORE anything is created in the target
  // tenant — a forward that can't close its source must not leave an orphan.
  assertTransition(request.status, "referred");

  const targetAgency = await repo.getAgency(target.peerAgencyId);
  if (!targetAgency) throw new NotFoundError("Agency", target.peerAgencyId);

  const at = deps.now();
  const requester = request.requesterId
    ? await repo.getRequester(input.agencyId, request.requesterId)
    : null;
  const shareContact = input.shareContact === true && requester?.email != null;

  // THE CROSSING — a real filing through the normal service layer, so the
  // target agency's own clock, milestone email (when contact is shared),
  // routing rules, and triage all run exactly as if the resident filed there.
  const forwardedRaw = await submitRequest(deps, {
    agencyId: targetAgency.id,
    rawText: request.rawText, // verbatim — the original is evidence (invariant 6)
    requester: shareContact
      ? { email: requester!.email!, name: requester!.name ?? undefined, type: requester!.type }
      : undefined,
  });

  const fromLink: ForwardLink = {
    agencyId: agency.id,
    agencySlug: agency.slug,
    agencyName: agency.name,
    requestId: request.id,
    publicId: request.publicId,
    at: at.toISOString(),
  };
  const toLink: ForwardLink = {
    agencyId: targetAgency.id,
    agencySlug: targetAgency.slug,
    agencyName: targetAgency.name,
    requestId: forwardedRaw.id,
    publicId: forwardedRaw.publicId,
    at: at.toISOString(),
  };

  const forwarded = await repo.updateRequest(targetAgency.id, forwardedRaw.id, {
    forwardedFrom: fromLink,
  });
  // The receiving trail must say where this came from. No source-tenant actor
  // id crosses — the sender is named as an agency, not a person.
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: targetAgency.id,
    requestId: forwarded.id,
    kind: "note",
    actorUserId: null,
    summary: `Forwarded from ${agency.name} (their ${request.publicId})`,
    payload: { forwardedFrom: fromLink, sharedContact: shareContact },
    createdAt: at,
  });

  // Close the source as referred — exactly the phase-1 outcome, plus the link.
  const updated = await repo.updateRequest(input.agencyId, request.id, {
    status: "referred",
    referredToDirectoryId: target.id,
    referredAt: at,
    closedAt: at,
    forwardedTo: toLink,
  });
  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "status_change",
    actorUserId: input.actorUserId,
    summary: `Forwarded to ${targetAgency.name} as ${forwarded.publicId} by ${actor.name ?? actor.email}`,
    payload: {
      from: request.status,
      to: "referred",
      directoryEntryId: target.id,
      forwardedTo: toLink,
      sharedContact: shareContact,
      note: input.note ?? null,
    },
    createdAt: at,
  });

  // Tell the requester where their request now lives.
  let requesterNotified = false;
  if (requester?.email && deps.notifier) {
    const letter = composeForwardingLetter({
      agencyName: agency.name,
      publicId: request.publicId,
      requesterName: requester.name,
      targetAgencyName: targetAgency.name,
      targetPublicId: forwarded.publicId,
      targetTrackLink: trackUrl(targetAgency.slug, forwarded.publicId, deps.baseUrl),
      sharedContact: shareContact,
      note: input.note,
    });
    const receipt = await deps.notifier.send({
      agencyId: input.agencyId,
      to: requester.email,
      subject: letter.subject,
      body: letter.body,
      kind: "requester_update",
      requestId: request.id,
    });
    await repo.createMessage({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      direction: "outbound",
      channel: "email",
      subject: letter.subject,
      body: letter.body,
      aiDrafted: false,
      sentByUserId: input.actorUserId, // named human on anything requester-facing
      sentAt: at,
      createdAt: at,
    });
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      kind: "delivery",
      actorUserId: input.actorUserId,
      summary: `Forwarding letter sent to ${requester.email}`,
      payload: { to: requester.email, channel: receipt.channel, deliveryId: receipt.id },
      createdAt: at,
    });
    requesterNotified = true;
  }

  return { request: updated, forwarded, target, requesterNotified };
}
