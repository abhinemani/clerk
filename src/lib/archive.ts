/**
 * The public archive (server only) — per-tenant reads over the public corpus:
 * documents with classification='public' (§6.7 hard-scopes the portal to
 * these). Each tenant sees ONLY its own releases; the demo fixture backs the
 * unseeded Riverton demo exactly as elsewhere in live.ts.
 */
import { DEMO_AGENCY, DEMO_RELEASES, searchPublicReleases } from "@/lib/demo";
import { getRepository } from "@/db/createRepository";
import { readDocumentMeta } from "@/domain/documentMeta";
import { parseDateQuery, withinRange, type DateRange } from "@/domain/dateQuery";
import type { DocumentEntity, ReleaseEntity, Repository } from "@/services/repository";

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
  /** The record's OWN date (meeting/report date), not when it was released —
   *  this is what a "last 3 months" window filters on. Falls back to the
   *  release date when the record never carried one. */
  recordDate: string;
  /** Plain-language questions this record has already answered (§ ask
   *  aliases, docs/answer-first.md). Searchable, and the reason the archive
   *  can say "someone asked this in March". */
  askedAs: string[];
  /**
   * Present when the record is a connected-source dataset slice
   * (docs/connected-sources.md): the requester-facing card states where the
   * data comes from and how fresh it is, flagged as an automated answer
   * from the city's public data — not a records determination.
   */
  connectedSource: { sourceName: string; dataset: string; period: string; syncedAt: string } | null;
}

function toArchiveItem(d: DocumentEntity, downloadUrl: string | null): ArchiveItem {
  const meta = readDocumentMeta(d);
  const stamp = meta.connectedSource;
  return {
    id: d.id,
    title: meta.title ?? d.filename ?? "Released record",
    summary: meta.summary ?? "",
    date: meta.releasedOn ?? d.createdAt.toISOString().slice(0, 10),
    tags: meta.tags ?? (d.recordType ? [d.recordType] : []),
    keywords: meta.keywords ?? [],
    downloadUrl,
    recordDate: meta.recordDate ?? meta.releasedOn ?? d.createdAt.toISOString().slice(0, 10),
    askedAs: meta.askedAs ?? [],
    connectedSource: stamp
      ? {
          sourceName: stamp.sourceName,
          dataset: stamp.dataset,
          period: stamp.period,
          syncedAt: stamp.syncedAt,
        }
      : null,
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

/** The map-based twin of resolveArchiveDownloadUrl — same rules, no query. */
function resolveDownloadUrlFromMap(
  slug: string,
  d: DocumentEntity,
  releaseById: Map<string, ReleaseEntity>,
): string | null {
  if (d.blobRef && d.byteSize != null) return `/${slug}/files/${d.id}`;
  const releaseId = readDocumentMeta(d).releaseId;
  if (!releaseId) return null;
  const release = releaseById.get(releaseId);
  if (!release || release.visibility !== "public") return null;
  const artifact = release.artifacts.find((a) => a.documentId);
  return artifact?.documentId ? `/${slug}/files/${artifact.documentId}` : null;
}

async function toItems(repo: Repository, agencyId: string, slug: string, docs: DocumentEntity[]) {
  // ONE release query for the whole listing. The old shape awaited
  // getReleaseById per release-born doc — an N+1 every archive render,
  // search, and answer-box keystroke paid.
  const needsReleases = docs.some(
    (d) => !(d.blobRef && d.byteSize != null) && readDocumentMeta(d).releaseId != null,
  );
  const releaseById = needsReleases
    ? new Map((await repo.listAllReleases(agencyId)).map((r) => [r.id, r] as const))
    : new Map<string, ReleaseEntity>();
  return docs.map((d) => toArchiveItem(d, resolveDownloadUrlFromMap(slug, d, releaseById)));
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

export interface ArchiveSearchResult {
  items: ArchiveItem[];
  /** Set when the query named a time window, so the UI can say which one. */
  range: DateRange | null;
  /** The subject actually matched on, once the window was lifted out. */
  subject: string;
  /** Ids whose match came from an ask alias — "someone asked this before". */
  matchedByAsk: string[];
}

/** Back-compatible shape: callers that just want the records. */
export async function searchArchive(slug: string, query: string): Promise<ArchiveItem[]> {
  return (await searchArchiveDetailed(slug, query)).items;
}

export async function searchArchiveDetailed(
  slug: string,
  query: string,
  now: Date = new Date(),
): Promise<ArchiveSearchResult> {
  // "Street cleanings for the last 3 months" is a subject AND a window.
  // Similarity search is blind to recency, so the window becomes a filter and
  // only the subject goes to the matchers.
  const parsed = parseDateQuery(query, now);
  const empty: ArchiveSearchResult = { items: [], range: parsed.range, subject: parsed.residual, matchedByAsk: [] };
  const q = parsed.residual.toLowerCase().trim();
  if (q.length < 3) return empty;

  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) {
    return slug === DEMO_AGENCY.slug
      ? { ...empty, items: searchPublicReleases(parsed.residual).map(demoToItem) }
      : empty;
  }

  const terms = q.split(/\s+/);
  const allDocs = await repo.listPublicDocuments(agency.id);
  const allItems = await toItems(repo, agency.id, slug, allDocs);

  // The window filters BEFORE ranking. Undated records survive it (see
  // withinRange) — "no date" means unknown, not old.
  const keep = parsed.range
    ? new Set(allItems.filter((it) => withinRange(it.recordDate, parsed.range!)).map((it) => it.id))
    : null;
  const docs = keep ? allDocs.filter((d) => keep.has(d.id)) : allDocs;
  const items = keep ? allItems.filter((it) => keep.has(it.id)) : allItems;
  const itemById = new Map(items.map((it) => [it.id, it]));

  const matchedByAsk = new Set<string>();
  const lexical = docs
    .map((d) => {
      const item = itemById.get(d.id)!;
      const base = [item.title, item.summary, ...item.tags, ...item.keywords].join(" ").toLowerCase();
      // Ask aliases are part of the haystack: this is how a record becomes
      // findable in the words residents actually use for it.
      const asks = item.askedAs.join(" ").toLowerCase();
      const score = terms.reduce(
        (s, t) => s + (base.includes(t) ? 1 : 0) + (asks.includes(t) ? 1 : 0),
        0,
      );
      if (score > 0 && terms.some((t) => asks.includes(t) && !base.includes(t))) {
        matchedByAsk.add(d.id);
      }
      return { id: d.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // Vector half — top-k ranked in the store (HNSW), not by loading every
  // vector into JS. Over-fetch because the date window (itemById) filters
  // AFTER the similarity ranking.
  let vector: { id: string; sim: number }[] = [];
  try {
    const [{ getEmbeddingProvider }] = await Promise.all([import("@/ai/search/voyage")]);
    const [qVec] = await getEmbeddingProvider().embed([q]);
    if (qVec) {
      vector = (await repo.searchPublicDocumentEmbeddings(agency.id, qVec, 50))
        .filter((x) => itemById.has(x.id)) // date window + public corpus, by construction
        .filter((x) => x.similarity > 0)
        .slice(0, 10)
        .map((x) => ({ id: x.id, sim: x.similarity }));
    }
  } catch (e) {
    console.error("archive vector search failed — keyword results only", e);
  }

  const rrf = new Map<string, number>();
  lexical.forEach((x, rank) => rrf.set(x.id, (rrf.get(x.id) ?? 0) + 1 / (RRF_K + rank)));
  vector.forEach((x, rank) => rrf.set(x.id, (rrf.get(x.id) ?? 0) + 1 / (RRF_K + rank)));

  const ranked = [...rrf.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => itemById.get(id)!)
    .filter(Boolean)
    .slice(0, 12);

  return {
    items: ranked,
    range: parsed.range,
    subject: parsed.residual,
    matchedByAsk: ranked.filter((it) => matchedByAsk.has(it.id)).map((it) => it.id),
  };
}

function demoToItem(r: (typeof DEMO_RELEASES)[number]): ArchiveItem {
  // The unseeded demo fixture has no real bytes to serve.
  return { id: r.id, title: r.title, summary: r.summary, date: r.date, tags: r.tags, keywords: r.keywords, downloadUrl: null, recordDate: r.date, askedAs: [], connectedSource: null };
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
