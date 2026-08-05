/**
 * Body-chunk embedding job (§6.4) — gives staff records search a semantic
 * half, so "trip and fall" finds "claimant caught his shoe and fell forward".
 *
 * Chunks 1+ of document_chunks cover the FULL corpus (internal included), which
 * is why only the staff-scoped search reads them; chunk 0 remains the
 * public archive-entry vector the requester-facing answer box uses.
 *
 * Runs off the request path after ingest/OCR. With no VOYAGE_API_KEY the
 * deterministic fake embedder still produces usable-in-dev vectors, exactly
 * like the archive backfill.
 */
import { chunkText } from "@/domain/chunking";
import { getEmbeddingProvider } from "@/ai/search/voyage";
import { getRepository } from "@/db/createRepository";
import type { JobPayloads } from "./queue";

/** Documents processed per run — keeps a big backfill off one long tick. */
const DOC_BATCH = 25;

export async function runEmbedDocumentChunksJob(
  payload: JobPayloads["embed_document_chunks"],
): Promise<void> {
  const repo = await getRepository();
  const [docs, alreadyChunked] = await Promise.all([
    repo.listDocuments(payload.agencyId),
    repo.listDocumentIdsWithBodyChunks(payload.agencyId),
  ]);

  const have = new Set(alreadyChunked);
  const targets = docs
    .filter((d) => {
      if (payload.documentId) return d.id === payload.documentId;
      return !have.has(d.id);
    })
    // Burned redaction artifacts are release copies, not source records.
    .filter((d) => d.extractedText != null && !d.externalSystemId?.startsWith("redacted:"))
    .slice(0, DOC_BATCH);
  if (targets.length === 0) return;

  const embedder = getEmbeddingProvider();
  for (const doc of targets) {
    const chunks = chunkText(doc.extractedText!);
    if (chunks.length === 0) {
      await repo.setDocumentBodyChunks(payload.agencyId, doc.id, []);
      continue;
    }
    // Prefix the filename so a chunk carries a little document identity into
    // its vector — helps "the Bright Path invoice" match the right file.
    const texts = chunks.map((c) => `${doc.filename ?? ""}\n${c.content}`.trim());
    const vectors = await embedder.embed(texts);
    await repo.setDocumentBodyChunks(
      payload.agencyId,
      doc.id,
      chunks.map((c, i) => ({ content: c.content, embedding: vectors[i]! })),
    );
  }
}
