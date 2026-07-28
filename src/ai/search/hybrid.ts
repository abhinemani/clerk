/**
 * Hybrid retriever (spec §6.4): keyword + vector, fused by reciprocal-rank
 * fusion. Same `Retriever` port and the same public-scope enforcement as the
 * lexical retriever — a public search can never return an internal document.
 */
import type { CorpusDoc } from "@/lib/corpus";
import type { EmbeddingProvider } from "./embeddings";
import { cosine } from "./embeddings";
import {
  assertPublicOnly,
  LexicalRetriever,
  type Candidate,
  type Retriever,
  type SearchOptions,
} from "./retriever";

const RRF_K = 60;

export class HybridRetriever implements Retriever {
  private readonly lexical: LexicalRetriever;
  private docVectors: number[][] | null = null;

  constructor(
    private readonly docs: CorpusDoc[],
    private readonly embedder: EmbeddingProvider,
  ) {
    this.lexical = new LexicalRetriever(docs);
  }

  private async vectors(): Promise<number[][]> {
    if (!this.docVectors) this.docVectors = await this.embedder.embed(this.docs.map((d) => `${d.title}. ${d.text}`));
    return this.docVectors;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<Candidate[]> {
    const scope = opts.scope ?? "public";
    const limit = opts.limit ?? 5;

    // Lexical half (already scope-enforced).
    const lex = await this.lexical.search(query, { ...opts, limit: 20 });

    // Vector half, over scope-filtered docs.
    const [qVec] = await this.embedder.embed([query]);
    const docVecs = await this.vectors();
    const vec = this.docs
      .map((doc, i) => ({ doc, sim: cosine(qVec!, docVecs[i]!) }))
      .filter(({ doc }) => (scope === "public" ? doc.classification === "public" : true))
      .filter(({ doc }) => (opts.recordType ? doc.recordType === opts.recordType : true))
      .filter(({ sim }) => sim > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 20);

    // Reciprocal-rank fusion.
    const rrf = new Map<string, number>();
    lex.forEach((c, rank) => rrf.set(c.id, (rrf.get(c.id) ?? 0) + 1 / (RRF_K + rank)));
    vec.forEach(({ doc }, rank) => rrf.set(doc.id, (rrf.get(doc.id) ?? 0) + 1 / (RRF_K + rank)));

    const byId = new Map(this.docs.map((d) => [d.id, d]));
    const lexById = new Map(lex.map((c) => [c.id, c]));

    const fused: Candidate[] = [...rrf.entries()]
      .map(([id, score]) => {
        const doc = byId.get(id)!;
        const lexHit = lexById.get(id);
        return {
          id,
          title: doc.title,
          score,
          classification: doc.classification,
          recordType: doc.recordType,
          whyMatched: lexHit?.whyMatched ?? "Semantically similar",
          snippet: lexHit?.snippet ?? doc.text.slice(0, 130) + "…",
          deepLink: doc.externalDeepLink,
        } satisfies Candidate;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (scope === "public") assertPublicOnly(fused);
    return fused;
  }
}
