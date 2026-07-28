/**
 * Voyage embedding provider — the real implementation behind the
 * EmbeddingProvider port (schema comment: "Anthropic pipelines embed via a
 * Voyage-class model"). Dimensionality must match EMBEDDING_DIMENSIONS (1024);
 * voyage-3.5 emits 1024 by default.
 *
 * `getEmbeddingProvider()` is the one factory the app should use: real when
 * VOYAGE_API_KEY is set, deterministic fake otherwise (hybrid search and
 * dedup keep working in dev, just without semantic quality).
 */
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { FakeEmbeddingProvider, type EmbeddingProvider } from "./embeddings";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-3.5";

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly apiKey: string, private readonly model = VOYAGE_MODEL) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });
    if (!res.ok) {
      throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/** Real provider when configured; deterministic fake otherwise. */
export function getEmbeddingProvider(): EmbeddingProvider {
  const key = process.env.VOYAGE_API_KEY;
  return key ? new VoyageEmbeddingProvider(key) : new FakeEmbeddingProvider(EMBEDDING_DIMENSIONS);
}
