/**
 * The public archive (server only) — per-tenant reads over the public corpus:
 * documents with classification='public' (§6.7 hard-scopes the portal to
 * these). Each tenant sees ONLY its own releases; the demo fixture backs the
 * unseeded Riverton demo exactly as elsewhere in live.ts.
 */
import { DEMO_AGENCY, DEMO_RELEASES, searchPublicReleases } from "@/lib/demo";
import { getRepository } from "@/db/createRepository";
import type { DocumentEntity } from "@/services/repository";

export interface ArchiveItem {
  id: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
  keywords: string[];
}

function toArchiveItem(d: DocumentEntity): ArchiveItem {
  const meta = (d.metadata ?? {}) as {
    title?: string;
    summary?: string;
    tags?: string[];
    keywords?: string[];
    releasedOn?: string;
  };
  return {
    id: d.id,
    title: meta.title ?? d.filename ?? "Released record",
    summary: meta.summary ?? "",
    date: meta.releasedOn ?? d.createdAt.toISOString().slice(0, 10),
    tags: meta.tags ?? (d.recordType ? [d.recordType] : []),
    keywords: meta.keywords ?? [],
  };
}

/** Everything this tenant has released, newest first. */
export async function listArchive(slug: string): Promise<ArchiveItem[]> {
  const repo = await getRepository();
  const agency = await repo.getAgencyBySlug(slug);
  if (!agency) return slug === DEMO_AGENCY.slug ? DEMO_RELEASES.map(demoToItem) : [];
  const docs = await repo.listPublicDocuments(agency.id);
  return docs.map(toArchiveItem);
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
  const itemById = new Map(docs.map((d) => [d.id, toArchiveItem(d)]));

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
  return { id: r.id, title: r.title, summary: r.summary, date: r.date, tags: r.tags, keywords: r.keywords };
}
