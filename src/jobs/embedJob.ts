/**
 * Archive-embedding backfill (§6.4/§6.7): give every public document a search
 * vector so the answer box ranks semantically, not just lexically. Runs after
 * boot and after anything that grows the public corpus (release, ingest).
 *
 * Uses the configured embedder — Voyage behind VOYAGE_API_KEY, deterministic
 * fake otherwise (dev keeps working; vectors upgrade when the key appears —
 * mixing fake and real vectors would rank garbage, so the job embeds ONLY
 * when the whole corpus can use the same provider... which it can, because
 * re-running after setting the key re-embeds nothing. Operators: to upgrade a
 * fake-embedded corpus, clear the embedding column and re-run.)
 */
import { getEmbeddingProvider } from "@/ai/search/voyage";
import { getRepository } from "@/db/createRepository";
import type { JobPayloads } from "./queue";

const BATCH = 64;

export async function runEmbedPublicDocumentsJob(
  payload: JobPayloads["embed_public_documents"],
): Promise<void> {
  const repo = await getRepository();
  const [docs, existing] = await Promise.all([
    repo.listPublicDocuments(payload.agencyId),
    repo.listPublicDocumentEmbeddings(payload.agencyId),
  ]);
  const have = new Set(existing.map((e) => e.id));
  const missing = docs.filter((d) => !have.has(d.id));
  if (missing.length === 0) return;

  const embedder = getEmbeddingProvider();
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const texts = batch.map(embedText);
    const vectors = await embedder.embed(texts);
    await Promise.all(
      batch.map((d, j) => repo.setDocumentEmbedding(payload.agencyId, d.id, vectors[j]!, texts[j]!)),
    );
  }
}

/** What a public archive entry "is", for search purposes. */
export function embedText(d: {
  filename: string | null;
  metadata: Record<string, unknown> | null;
}): string {
  const meta = (d.metadata ?? {}) as {
    title?: string;
    summary?: string;
    tags?: string[];
    keywords?: string[];
  };
  return [meta.title ?? d.filename ?? "", meta.summary ?? "", ...(meta.tags ?? []), ...(meta.keywords ?? [])]
    .filter(Boolean)
    .join(". ");
}
