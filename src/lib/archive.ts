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
 * Lexical search over the tenant's public corpus — the §6.7 deflection front
 * door. Same scoring as the original demo box, now per-tenant and live.
 */
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
  return docs
    .map((d) => {
      const item = toArchiveItem(d);
      const hay = [item.title, item.summary, ...item.tags, ...item.keywords].join(" ").toLowerCase();
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

function demoToItem(r: (typeof DEMO_RELEASES)[number]): ArchiveItem {
  return { id: r.id, title: r.title, summary: r.summary, date: r.date, tags: r.tags, keywords: r.keywords };
}
