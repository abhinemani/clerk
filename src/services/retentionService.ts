/**
 * Retention holds (§ retention) — the service half of src/domain/retention.ts.
 *
 * The rule this enforces: a document that is responsive to an OPEN request
 * must not be destroyed. Attaching a document to an open request places an
 * automatic hold; closing the request lifts holds that no other open request
 * still justifies. Human-placed holds (litigation, audit) are never touched by
 * the automation — only a named human clears those.
 */
import { autoHoldReason, isAutoHold } from "@/domain/retention";
import type { ServiceDeps } from "./deps";
import { NotFoundError } from "./repository";

/**
 * Place the automatic "responsive to an open request" hold. No-op when the
 * document already carries any hold — a human's litigation hold outranks ours
 * and must not be overwritten with a weaker auto reason.
 */
export async function holdForOpenRequest(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string; documentId: string },
): Promise<void> {
  const { repo } = deps;
  const [request, document] = await Promise.all([
    repo.getRequest(input.agencyId, input.requestId),
    repo.getDocument(input.agencyId, input.documentId),
  ]);
  if (!request || !document) return;
  if (request.closedAt != null) return; // closed request — nothing to protect
  if (document.legalHoldReason) return; // already held (possibly by a human)

  await repo.updateDocument(input.agencyId, document.id, {
    legalHoldReason: autoHoldReason(request.publicId),
  });
}

/**
 * Lift automatic holds a request no longer justifies. Called when a request
 * closes. A document still attached to another OPEN request keeps its hold,
 * re-pointed at that request; human-placed holds are left alone entirely.
 */
export async function releaseHoldsForClosedRequest(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string },
): Promise<{ cleared: number; kept: number }> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  const docs = await repo.listRequestDocuments(input.agencyId, input.requestId);
  const held = docs.filter((d) => isAutoHold(d.legalHoldReason));
  if (held.length === 0) return { cleared: 0, kept: 0 };

  // Which other requests are still open? Anything they hold stays held.
  const openRequests = (await repo.listRequests(input.agencyId)).filter(
    (r) => r.closedAt == null && r.id !== input.requestId,
  );
  const stillNeeded = new Map<string, string>(); // documentId -> publicId
  for (const r of openRequests) {
    for (const d of await repo.listRequestDocuments(input.agencyId, r.id)) {
      if (!stillNeeded.has(d.id)) stillNeeded.set(d.id, r.publicId);
    }
  }

  let cleared = 0;
  let kept = 0;
  for (const doc of held) {
    const otherPublicId = stillNeeded.get(doc.id);
    if (otherPublicId) {
      // Keep the hold, but make it name the request that now justifies it.
      await repo.updateDocument(input.agencyId, doc.id, {
        legalHoldReason: autoHoldReason(otherPublicId),
      });
      kept++;
    } else {
      await repo.updateDocument(input.agencyId, doc.id, { legalHoldReason: null });
      cleared++;
    }
  }

  if (cleared > 0 || kept > 0) {
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: input.requestId,
      kind: "note",
      actorUserId: null,
      summary: `Retention holds updated on close: ${cleared} lifted${kept > 0 ? `, ${kept} kept for other open requests` : ""}`,
      payload: { source: "retention", cleared, kept },
      createdAt: deps.now(),
    });
  }
  return { cleared, kept };
}

/** Set or clear a human's legal hold — always attributable. */
export async function setLegalHold(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    documentId: string;
    reason: string | null;
    actorUserId: string;
    /** Optional request context, so the action lands on that request's trail. */
    requestId?: string;
  },
): Promise<void> {
  const { repo } = deps;
  const [document, actor] = await Promise.all([
    repo.getDocument(input.agencyId, input.documentId),
    repo.getUser(input.agencyId, input.actorUserId),
  ]);
  if (!document) throw new NotFoundError("Document", input.documentId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);

  const reason = input.reason?.trim() || null;
  await repo.updateDocument(input.agencyId, input.documentId, { legalHoldReason: reason });

  if (input.requestId) {
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: input.requestId,
      kind: "note",
      actorUserId: input.actorUserId,
      summary: reason
        ? `${actor.name ?? actor.email} placed a legal hold on ${document.filename ?? document.id}: ${reason}`
        : `${actor.name ?? actor.email} lifted the legal hold on ${document.filename ?? document.id}`,
      payload: { source: "retention", documentId: document.id, reason },
      createdAt: deps.now(),
    });
  }
}
