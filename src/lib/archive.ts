/**
 * The public archive (server only) — per-tenant reads over the public corpus:
 * documents with classification='public' (§6.7 hard-scopes the portal to
 * these). Each tenant sees ONLY its own releases; the demo fixture backs the
 * unseeded Riverton demo exactly as elsewhere in live.ts.
 */
import { DEMO_AGENCY, DEMO_RELEASES, searchPublicReleases } from "@/lib/demo";
import { getRepository } from "@/db/createRepository";
import { readDocumentMeta } from "@/domain/documentMeta";
import type { DocumentEntity, Repository } from "@/services/repository";

export interface ArchiveItem {
  id: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
  keywords: string[];
  /**
   * Where the record's actual bytes download from, or null for metadata-only
   * entries (nothing to serve). Always a /{slug}/files/{docId} URL — the one
   * gate enforces entitlements; this only resolves WHICH document holds the
   * bytes.
   */
  downloadUrl: string | null;
}

function toArchiveItem(d: DocumentEntity, downloadUrl: string | null): ArchiveItem {
  const meta = readDocumentMeta(d);
  return {
    id: d.id,
    title: meta.title ?? d.filename ?? "Released record",
    summary: meta.summary ?? "",
    date: meta.releasedOn ?? d.createdAt.toISOString().slice(0, 10),
    tags: meta.tags ?? (d.recordType ? [d.recordType] : []),
    keywords: meta.keywords ?? [],
    downloadUrl,
  };
}

/**
 * The document whose bytes an archive entry downloads: itself when it carries
 * a blob; for release-born entries (metadata.releaseId), the release's first
 * frozen artifact — the burned/approved bytes a named human shipped. Null for
 * metadata-only entries. Exported for tests.
 */
export async function resolveArchiveDownloadUrl(
  repo: Repository,
  agencyId: string,
  slug: string,
  d: DocumentEntity,
): Promise<string | null> {
  if (d.blobRef && d.byteSize != null) return `/${slug}/files/${d.id}`;
  const releaseId = readDocumentMeta(d).releaseId;
  if (!releaseId) return null;
  const release = await repo.getReleaseById(agencyId, releaseId);
  // Only public releases feed the archive; enforce it here too, not just at
  // the gate — a private release's artifacts never get advertised.
  if (!release || release.visibility !== "public") return null;
  const artifact = release.artifacts.find((a) => a.documentId);
  return artifact?.documentId ? `/${slug}/files/${artifact.documentId}` : null;
}

async function toItems(repo: Repository, agencyId: string, slug: string, docs: DocumentEntity[]) {
  return Promise.all(
    docs.map(async (d) => toArchiveItem(d, await resolveArchiveDownloadUrl(repo, agencyId, slug, d))),
  );
}

/** Everything this tenant has released, newest first. */
export async function listArchive(slug: string): Promise<ArchiveItem[]> {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return slug === DEMO_AGENCY.slug ? DEMO_RELEASES.map(demoToItem) : [];
  const docs = await repo.listPublicDocuments(agency.id);
  return toItems(repo, agency.id, slug, docs);
}

/**
 * Hybrid search over the tenant's public corpus — the §6.7 deflection front
 * door. Keyword scoring fused (reciprocal-rank) with vector similarity from
 * the archive embeddings the backfill job maintains; degrades to keyword-only
 * when no vectors exist yet. Retrieval stays hard-scoped to
 * classification='public' at the query layer (invariant 3) — both halves read
 * only the public corpus.
 */
const RRF_K = 60;

export async function searchArchive(slug: string, query: string): Promise<ArchiveItem[]> {
  const q = query.toLowerCase().trim();
  if (q.length < 3) return [];

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) {
    return slug === DEMO_AGENCY.slug ? searchPublicReleases(query).map(demoToItem) : [];
  }

  const terms = q.split(/\s+/);
  const docs = await repo.listPublicDocuments(agency.id);
  const items = await toItems(repo, agency.id, slug, docs);
  const itemById = new Map(items.map((it) => [it.id, it]));

  const lexical = docs
    .map((d) => {
      const item = itemById.get(d.id)!;
      const hay = [item.title, item.summary, ...item.tags, ...item.keywords].join(" ").toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { id: d.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Vector half — only over docs the backfill job has embedded.
  let vector: { id: string; sim: number }[] = [];
  try {
    const embeddings = await repo.listPublicDocumentEmbeddings(agency.id);
    if (embeddings.length > 0) {
      const [{ getEmbeddingProvider }, { cosine }] = await Promise.all([
        import("@/ai/search/voyage"),
        import("@/ai/search/embeddings"),
      ]);
      const [qVec] = await getEmbeddingProvider().embed([q]);
      vector = embeddings
        .filter((e) => itemById.has(e.id)) // public corpus only, by construction
        .map((e) => ({ id: e.id, sim: cosine(qVec!, e.embedding) }))
        .filter((x) => x.sim > 0)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 10);
    }
  } catch (e) {
    console.error("archive vector search failed — keyword results only", e);
  }

  const rrf = new Map<string, number>();
  lexical.forEach((x, rank) => rrf.set(x.id, (rrf.get(x.id) ?? 0) + 1 / (RRF_K + rank)));
  vector.forEach((x, rank) => rrf.set(x.id, (rrf.get(x.id) ?? 0) + 1 / (RRF_K + rank)));

  return [...rrf.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => itemById.get(id)!)
    .filter(Boolean)
    .slice(0, 12);
}

function demoToItem(r: (typeof DEMO_RELEASES)[number]): ArchiveItem {
  // The unseeded demo fixture has no real bytes to serve.
  return { id: r.id, title: r.title, summary: r.summary, date: r.date, tags: r.tags, keywords: r.keywords, downloadUrl: null };
}

// --- record permalinks ------------------------------------------------------

export interface ArchiveRecord extends ArchiveItem {
  recordType: string | null;
  /** Full text rendition of the PUBLIC record — safe to show by definition. */
  extractedText: string | null;
  pageCount: number | null;
  /** When the record was born from a release: the request it answered. */
  sourceRequestPublicId: string | null;
}

/**
 * One public record by id — the permalink page's data (§6.7: every released
 * record is a citable URL). Invariant 3 enforced here like everywhere
 * requester-facing: a non-public document resolves to null, indistinguishable
 * from not existing.
 */
export async function getArchiveRecord(slug: string, id: string): Promise<ArchiveRecord | null> {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) {
    // Unseeded demo fixture: metadata-only entries, no bytes, no text.
    const demo = slug === DEMO_AGENCY.slug ? DEMO_RELEASES.find((r) => r.id === id) : undefined;
    return demo
      ? { ...demoToItem(demo), recordType: demo.tags[0] ?? null, extractedText: null, pageCount: null, sourceRequestPublicId: null }
      : null;
  }
  return buildArchiveRecord(repo, agency.id, slug, id);
}

/** The live half of getArchiveRecord — repo-injected, exported for tests. */
export async function buildArchiveRecord(
  repo: Repository,
  agencyId: string,
  slug: string,
  id: string,
): Promise<ArchiveRecord | null> {
  const doc = await repo.getDocument(agencyId, id);
  if (!doc || doc.classification !== "public") return null; // public-only, hard

  let sourceRequestPublicId: string | null = null;
  const releaseId = (doc.metadata as { releaseId?: string } | null)?.releaseId;
  if (releaseId) {
    const release = await repo.getReleaseById(agencyId, releaseId);
    if (release?.visibility === "public") {
      const request = await repo.getRequest(agencyId, release.requestId);
      sourceRequestPublicId = request?.publicId ?? null;
    }
  }

  return {
    ...toArchiveItem(doc, await resolveArchiveDownloadUrl(repo, agencyId, slug, doc)),
    recordType: doc.recordType ?? null,
    extractedText: doc.extractedText ?? null,
    pageCount: doc.pageCount ?? null,
    sourceRequestPublicId,
  };
}
