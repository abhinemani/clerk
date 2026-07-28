/**
 * Responsive-records search (spec §6.4) + the retrieval half of the requester
 * answer engine (§6.7).
 *
 * The `Retriever` port lets a lexical implementation work now (no embeddings) and
 * a hybrid keyword+vector implementation drop in later. Crucially, scope is
 * enforced HERE, in the query layer: a `"public"` search can only ever return
 * public documents — the §16.3 hard rule and the §13 hard-fail invariant. Every
 * candidate carries a one-line "why this matched" rationale (§6.4).
 */
import type { CorpusDoc } from "@/lib/corpus";

export type CorpusScope = "public" | "full";

export interface Candidate {
  id: string;
  title: string;
  score: number;
  whyMatched: string;
  classification: "public" | "internal";
  recordType?: string;
  snippet: string;
  deepLink?: string;
}

export interface SearchOptions {
  /** Retrieval scope. Requester-side callers MUST pass "public" (default). */
  scope?: CorpusScope;
  limit?: number;
  recordType?: string;
}

export interface Retriever {
  search(query: string, opts?: SearchOptions): Promise<Candidate[]>;
}

export class InternalLeakError extends Error {
  constructor(ids: string[]) {
    super(`Public retrieval returned internal documents: ${ids.join(", ")} — hard fail (§13).`);
    this.name = "InternalLeakError";
  }
}

/** Defense in depth: assert a public-scoped result set contains no internal docs. */
export function assertPublicOnly(candidates: Candidate[]): void {
  const leaked = candidates.filter((c) => c.classification !== "public").map((c) => c.id);
  if (leaked.length > 0) throw new InternalLeakError(leaked);
}

const STOPWORDS = new Set([
  "the", "and", "for", "you", "are", "was", "has", "have", "had", "not", "but", "any",
  "all", "can", "our", "its", "out", "with", "that", "this", "from", "your", "their",
  "into", "who", "what", "where", "when", "does", "did", "give", "get", "want", "show",
  "please", "need", "would", "could", "about", "there",
]);

function tokenize(s: string): string[] {
  return [
    ...new Set(
      s
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
    ),
  ];
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const hit = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const start = hit == null ? 0 : Math.max(0, hit - 30);
  return (start > 0 ? "…" : "") + text.slice(start, start + 130).trim() + "…";
}

/** Keyword retriever over an in-memory corpus. Scope-enforcing. */
export class LexicalRetriever implements Retriever {
  constructor(private readonly docs: CorpusDoc[]) {}

  async search(query: string, opts: SearchOptions = {}): Promise<Candidate[]> {
    const scope = opts.scope ?? "public";
    const limit = opts.limit ?? 5;
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const candidates: Candidate[] = [];
    for (const doc of this.docs) {
      // Scope is enforced at the source: public search never even considers internal docs.
      if (scope === "public" && doc.classification !== "public") continue;
      if (opts.recordType && doc.recordType !== opts.recordType) continue;

      // Whole-word (token) matching — avoids substring false positives like
      // "work" matching "works" or "pending" matching "spending".
      const titleTokens = new Set(tokenize(doc.title));
      const textTokens = new Set(tokenize(doc.text));
      const matched: string[] = [];
      let score = 0;
      for (const t of terms) {
        if (titleTokens.has(t)) {
          score += 2;
          matched.push(t);
        } else if (textTokens.has(t)) {
          score += 1;
          matched.push(t);
        }
      }
      if (score === 0) continue;

      candidates.push({
        id: doc.id,
        title: doc.title,
        score,
        classification: doc.classification,
        recordType: doc.recordType,
        whyMatched: `Matches “${[...new Set(matched)].join(", ")}”`,
        snippet: snippet(doc.text, terms),
        deepLink: doc.externalDeepLink,
      });
    }

    const ranked = candidates.sort((a, b) => b.score - a.score).slice(0, limit);
    if (scope === "public") assertPublicOnly(ranked); // belt and suspenders
    return ranked;
  }
}
