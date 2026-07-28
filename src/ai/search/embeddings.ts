/**
 * Embedding port (spec §4/§6.4). The real provider calls a Voyage/Anthropic-class
 * embedding model; the deterministic fake below lets the hybrid retriever and
 * duplicate detector be built and tested now, before pgvector lands.
 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h);
}

/**
 * Deterministic hashed bag-of-words embedding. Not semantic, but texts that share
 * vocabulary get similar vectors — enough to exercise vector ranking + dedup in
 * tests without a network call.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dim = 96) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vec(t));
  }

  private vec(text: string): number[] {
    const v = new Array(this.dim).fill(0);
    for (const tok of text.toLowerCase().split(/\W+/).filter((x) => x.length >= 2)) {
      v[hash(tok) % this.dim] += 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}
