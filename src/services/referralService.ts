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
import { NotFoundError, type DirectoryEntry, type RequestEntity } from "./repository";

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
