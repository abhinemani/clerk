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
import type { ServiceDeps } from "./deps";
import { NotFoundError, type DocumentEntity, type SourceEntity } from "./repository";

export class PublicationError extends Error {}

export interface PublicationDecision {
  decision: "published" | "internal";
  byUserId: string;
  byName: string;
  at: string; // ISO
}

function decisionOf(doc: DocumentEntity): PublicationDecision | null {
  const d = (doc.metadata as { publicationDecision?: PublicationDecision } | null)?.publicationDecision;
  return d ?? null;
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

  const prev = (doc.metadata ?? {}) as Record<string, unknown>;
  const meta = input.archiveMeta ?? {};
  const title = meta.title?.trim() || (prev.title as string | undefined) || doc.filename || "Released record";
  const decision: PublicationDecision = {
    decision: "published",
    byUserId: actor.id,
    byName: actor.name ?? actor.email,
    at: deps.now().toISOString(),
  };
  await repo.updateDocument(input.agencyId, doc.id, {
    metadata: {
      ...prev,
      title,
      summary: meta.summary?.trim() || (prev.summary as string | undefined) || "",
      tags: meta.tags ?? (prev.tags as string[] | undefined) ?? (doc.recordType ? [doc.recordType] : []),
      keywords: meta.keywords ?? (prev.keywords as string[] | undefined) ?? [],
      // The archive shows the record's own date when the import knew it.
      releasedOn: (prev.recordDate as string | undefined) ?? deps.now().toISOString().slice(0, 10),
      publicationDecision: decision,
    },
  });
  const published = await repo.setDocumentClassification(input.agencyId, doc.id, "public");

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
    metadata: { ...(doc.metadata ?? {}), publicationDecision: decision },
  });

  await repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    kind: "record_kept_internal",
    actorLabel: actor.name ?? actor.email,
    summary: `Kept "${(doc.metadata as { title?: string } | null)?.title ?? doc.filename ?? doc.id}" internal`,
    payload: { documentId: doc.id, sourceId: doc.sourceId },
    createdAt: deps.now(),
  });
  return updated;
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
