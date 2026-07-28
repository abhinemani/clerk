/**
 * Duplicate & related-request detection (spec §6.2).
 *
 * On intake, compare a new request against the agency's existing requests and
 * surface "possibly duplicate of PR-…". Works now with lexical (Jaccard)
 * similarity; pass an EmbeddingProvider to use semantic similarity instead.
 */
import type { EmbeddingProvider } from "@/ai/search/embeddings";
import { cosine } from "@/ai/search/embeddings";

export interface RequestLike {
  id: string;
  publicId: string;
  text: string;
}

export interface DuplicateMatch {
  id: string;
  publicId: string;
  similarity: number;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/\W+/).filter((t) => t.length >= 3));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DuplicateOptions {
  threshold?: number;
  limit?: number;
  embedder?: EmbeddingProvider;
}

/**
 * Find existing requests similar to `text`, most-similar first, above threshold.
 */
export async function findDuplicates(
  text: string,
  existing: RequestLike[],
  opts: DuplicateOptions = {},
): Promise<DuplicateMatch[]> {
  const threshold = opts.threshold ?? 0.5;
  const limit = opts.limit ?? 5;

  let scored: DuplicateMatch[];
  if (opts.embedder) {
    const [qVec, ...docVecs] = await opts.embedder.embed([text, ...existing.map((e) => e.text)]);
    scored = existing.map((e, i) => ({ id: e.id, publicId: e.publicId, similarity: cosine(qVec!, docVecs[i]!) }));
  } else {
    const qTok = tokens(text);
    scored = existing.map((e) => ({ id: e.id, publicId: e.publicId, similarity: jaccard(qTok, tokens(e.text)) }));
  }

  return scored
    .filter((m) => m.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
