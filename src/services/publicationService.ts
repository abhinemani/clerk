/**
 * Publication decisions (docs/records-ingestion.md §2) — the human surface
 * where "classification IS the publication decision" gets decided. Piped-in
 * records arrive internal; a NAMED staff member publishes each one to the
 * archive or keeps it internal, and every decision is an audited admin event
 * (invariant 4 — publishing reaches the public).
 *
 * Also home to source-trust management (§4): the same publication policy,
 * expressed per source instead of per document.
 */
import {
  patchDocumentMeta,
  readDocumentMeta,
  type PublicationDecision,
} from "@/domain/documentMeta";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity, type SourceEntity } from "./repository";

export class PublicationError extends Error {}

export type { PublicationDecision };

function decisionOf(doc: DocumentEntity): PublicationDecision | null {
  return readDocumentMeta(doc).publicationDecision ?? null;
}

/** Burned redaction artifacts belong to the release flow, never this queue. */
function isReleaseArtifact(doc: DocumentEntity): boolean {
  return doc.externalSystemId?.startsWith("redacted:") === true || doc.provenance === "prior_release";
}

export interface PublicationQueues {
  /** Internal, unattached, undecided — what needs a human. */
  undecided: DocumentEntity[];
  /** Everything public (named-human publishes and auto-publish sources alike). */
  published: DocumentEntity[];
  /** Explicitly kept internal — out of the queue, still in staff search. */
  keptInternal: DocumentEntity[];
}

/**
 * The decision surface's three tabs. Documents attached to any request are
 * excluded everywhere — those belong to the request review flow (no
 * double-review), and their path to the archive is a release.
 */
export async function listPublicationQueues(deps: ServiceDeps, agencyId: string): Promise<PublicationQueues> {
  const [docs, attachedIds] = await Promise.all([
    deps.repo.listDocuments(agencyId),
    deps.repo.listAttachedDocumentIds(agencyId),
  ]);
  const attached = new Set(attachedIds);
  const eligible = docs.filter((d) => !attached.has(d.id) && !isReleaseArtifact(d));

  return {
    undecided: eligible.filter((d) => d.classification === "internal" && decisionOf(d) == null),
    published: eligible.filter((d) => d.classification === "public"),
    keptInternal: eligible.filter((d) => d.classification === "internal" && decisionOf(d)?.decision === "internal"),
  };
}

export interface ArchiveMeta {
  title?: string;
  summary?: string;
  tags?: string[];
  keywords?: string[];
}

/**
 * Publish one document to the public archive — THE named-human act that flips
 * internal→public (invariant 9). Refuses documents in any request's review
 * set (that path goes through release approval, not this shortcut).
 */
export async function publishDocument(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; documentId: string; archiveMeta?: ArchiveMeta },
): Promise<DocumentEntity> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const doc = await repo.getDocument(input.agencyId, input.documentId);
  if (!doc) throw new NotFoundError("Document", input.documentId);

  if (isReleaseArtifact(doc)) {
    throw new PublicationError("Release artifacts are published through release approval, not here.");
  }
  const attached = new Set(await repo.listAttachedDocumentIds(input.agencyId));
  if (attached.has(doc.id)) {
    throw new PublicationError(
      "This document is in a request's review set — release it through that request instead.",
    );
  }
  if (doc.classification === "public") return doc; // already published — nothing to redo

  const prev = readDocumentMeta(doc);
  const meta = input.archiveMeta ?? {};
  const title = meta.title?.trim() || prev.title || doc.filename || "Released record";
  const decision: PublicationDecision = {
    decision: "published",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    at: deps.now().toISOString(),
  };
  await repo.updateDocument(input.agencyId, doc.id, {
    metadata: patchDocumentMeta(doc, {
      title,
      summary: meta.summary?.trim() || prev.summary || "",
      tags: meta.tags ?? prev.tags ?? (doc.recordType ? [doc.recordType] : []),
      keywords: meta.keywords ?? prev.keywords ?? [],
      // The archive shows the record's own date when the import knew it.
      releasedOn: prev.recordDate ?? deps.now().toISOString().slice(0, 10),
      publicationDecision: decision,
    }),
  });
  const published = await repo.setDocumentClassification(input.agencyId, doc.id, "public");

  // Tamper-evident history first-class (the jsonb stamp above is its cache).
  await repo.appendPublicationDecision({
    id: deps.genId(),
    agencyId: input.agencyId,
    documentId: doc.id,
    decision: "published",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    reason: null,
    createdAt: deps.now(),
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "record_published",
    actorLabel: actor.name ?? actor.email,
    summary: `Published "${title}" to the public archive`,
    payload: { documentId: doc.id, sourceId: doc.sourceId, filename: doc.filename },
    createdAt: deps.now(),
  });
  return published;
}

/**
 * Keep one document internal — an equally recorded decision, so the queue
 * empties honestly. The document stays in staff search (§6.4); nothing about
 * it becomes requester-visible.
 */
export async function keepDocumentInternal(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; documentId: string },
): Promise<DocumentEntity> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const doc = await repo.getDocument(input.agencyId, input.documentId);
  if (!doc) throw new NotFoundError("Document", input.documentId);
  if (doc.classification === "public") {
    throw new PublicationError("Already published — unpublishing is not a records-queue action.");
  }

  const decision: PublicationDecision = {
    decision: "internal",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    at: deps.now().toISOString(),
  };
  const updated = await repo.updateDocument(input.agencyId, doc.id, {
    metadata: patchDocumentMeta(doc, { publicationDecision: decision }),
  });

  await repo.appendPublicationDecision({
    id: deps.genId(),
    agencyId: input.agencyId,
    documentId: doc.id,
    decision: "kept_internal",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    reason: null,
    createdAt: deps.now(),
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "record_kept_internal",
    actorLabel: actor.name ?? actor.email,
    summary: `Kept "${readDocumentMeta(doc).title ?? doc.filename ?? doc.id}" internal`,
    payload: { documentId: doc.id, sourceId: doc.sourceId },
    createdAt: deps.now(),
  });
  return updated;
}

/**
 * Emergency takedown: pull a published record back to internal. The reverse
 * gear publishing needs — "we published PII" cannot wait for a release
 * process. Requires a NAMED human and a stated reason; both land in the
 * append-only admin audit. The archive, answer box, and deflection all
 * hard-scope to classification='public' at the query layer (invariant 3),
 * so the record disappears from every requester-facing surface the moment
 * the column flips — no cache or embedding cleanup in the critical path.
 */
export async function unpublishDocument(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; documentId: string; reason: string },
): Promise<DocumentEntity> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const doc = await repo.getDocument(input.agencyId, input.documentId);
  if (!doc) throw new NotFoundError("Document", input.documentId);

  const reason = input.reason.trim();
  if (!reason) {
    throw new PublicationError("State why this record is being unpublished — the reason is part of the audit record.");
  }
  if (doc.classification !== "public") {
    throw new PublicationError("This record is not public — nothing to unpublish.");
  }
  if (isReleaseArtifact(doc)) {
    throw new PublicationError("Release artifacts are managed through the release flow, not here.");
  }

  const title = readDocumentMeta(doc).title ?? doc.filename ?? doc.id;
  const decision: PublicationDecision = {
    decision: "internal",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    at: deps.now().toISOString(),
    reason: reason.slice(0, 500),
  };
  await repo.updateDocument(input.agencyId, doc.id, {
    metadata: patchDocumentMeta(doc, { publicationDecision: decision }),
  });
  const unpublished = await repo.setDocumentClassification(input.agencyId, doc.id, "internal");

  await repo.appendPublicationDecision({
    id: deps.genId(),
    agencyId: input.agencyId,
    documentId: doc.id,
    decision: "unpublished",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    reason: reason.slice(0, 500),
    createdAt: deps.now(),
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "record_unpublished",
    actorLabel: actor.name ?? actor.email,
    summary: `UNPUBLISHED "${title}" from the public archive — ${reason.slice(0, 200)}`,
    payload: { documentId: doc.id, sourceId: doc.sourceId, filename: doc.filename, reason },
    createdAt: deps.now(),
  });
  return unpublished;
}

// --- source trust management (§4) -------------------------------------------

/**
 * Switch a source between review_queue (everything lands in the decision
 * queue) and auto_publish (a feed the office already vets — agendas, minutes —
 * goes straight to the archive). Explicit, admin-only, audited: this is the
 * ONE configuration that lets records skip the named-human publish.
 */
export async function updateSourcePolicy(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    actorUserId: string;
    sourceId: string;
    trust: "auto_publish" | "review_queue";
    defaultClassification: "public" | "internal";
  },
): Promise<SourceEntity> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const source = (await repo.listSources(input.agencyId)).find((s) => s.id === input.sourceId);
  if (!source) throw new NotFoundError("Source", input.sourceId);

  const updated = await repo.updateSource(input.agencyId, input.sourceId, {
    trust: input.trust,
    defaultClassification: input.defaultClassification,
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "source_policy_changed",
    actorLabel: actor.name ?? actor.email,
    summary: `Source "${source.name}" set to ${
      input.trust === "auto_publish" ? "auto-publish" : "review queue"
    } (default ${input.defaultClassification})`,
    payload: { sourceId: source.id, trust: input.trust, defaultClassification: input.defaultClassification },
    createdAt: deps.now(),
  });
  return updated;
}

/**
 * Rotate an API source's ingest key: new key minted, old hash replaced (the
 * old key stops working immediately), raw key surfaces exactly ONCE in the
 * return value — only its hash is stored, same rule as provisioning.
 */
export async function rotateSourceApiKey(
  deps: ServiceDeps,
  input: { agencyId: string; actorUserId: string; sourceId: string },
): Promise<{ source: SourceEntity; ingestKey: string }> {
  const { repo } = deps;
  const actor = await repo.getUser(input.agencyId, input.actorUserId);
  if (!actor) throw new NotFoundError("User", input.actorUserId);
  const source = (await repo.listSources(input.agencyId)).find((s) => s.id === input.sourceId);
  if (!source) throw new NotFoundError("Source", input.sourceId);
  if (source.type !== "api_push") {
    throw new PublicationError("Only API sources carry an ingest key.");
  }

  const { randomBytes, createHash } = await import("node:crypto");
  const ingestKey = `ck_${randomBytes(24).toString("base64url")}`;
  const updated = await repo.updateSource(input.agencyId, input.sourceId, {
    apiKeyHash: createHash("sha256").update(ingestKey).digest("hex"),
  });
  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "source_key_rotated",
    actorLabel: actor.name ?? actor.email,
    summary: `Rotated the ingest key for source "${source.name}" — the old key no longer works`,
    payload: { sourceId: source.id },
    createdAt: deps.now(),
  });
  return { source: updated, ingestKey };
}
