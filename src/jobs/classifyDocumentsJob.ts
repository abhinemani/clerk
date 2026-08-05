/**
 * Classification hints for the publication queue (docs/records-ingestion.md
 * §3): after a records import, run the existing auto-classification pipeline
 * over the new documents so each queue row can show a suggested
 * public/internal with a rationale. Suggestions ONLY — metadata.aiClassification
 * is a hint the queue renders; the classification column moves exclusively
 * through publicationService's named-human publish (invariant 9).
 *
 * No ANTHROPIC_API_KEY → quietly skips (the queue works fine without hints).
 */
import { AnthropicModelClient } from "@/ai/modelClient";
import { classifyDocumentPipeline, type ClassifyDocumentOutput } from "@/ai/pipelines/classifyDocument";
import { runPipeline } from "@/ai/runPipeline";
import { getRepository } from "@/db/createRepository";
import type { JobPayloads } from "./queue";

export async function runClassifyDocumentsJob(payload: JobPayloads["classify_documents"]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const repo = await getRepository();
  const departments = await repo.listDepartments(payload.agencyId);
  const modelClient = new AnthropicModelClient(apiKey);

  const classified: string[] = [];
  for (const documentId of payload.documentIds) {
    const doc = await repo.getDocument(payload.agencyId, documentId);
    if (!doc) continue;
    const meta = (doc.metadata ?? {}) as { aiClassification?: unknown; title?: string; summary?: string };
    if (meta.aiClassification != null) continue; // idempotent on retry

    // Metadata-only records still get a hint from their catalog entry.
    const text = doc.extractedText ?? [meta.title, meta.summary].filter(Boolean).join("\n");
    if (!text.trim()) continue;

    const result = await runPipeline(
      classifyDocumentPipeline,
      { filename: doc.filename ?? undefined, text, departments: departments.map((d) => d.name) },
      { modelClient },
    );
    const c: ClassifyDocumentOutput = result.output;
    await repo.updateDocument(payload.agencyId, doc.id, {
      metadata: {
        ...(doc.metadata ?? {}),
        aiClassification: {
          recordType: c.recordType,
          department: c.department,
          suggestedClassification: c.classification,
          suggestedMetadata: c.suggestedMetadata,
          sensitivityNote: c.sensitivityNote,
        },
      },
    });
    classified.push(doc.id);
  }

  if (classified.length > 0) {
    // AI provenance on the record (there's no request to log against, so the
    // admin audit carries it): one event per batch, not one per document.
    await repo.appendAdminEvent({
      id: crypto.randomUUID(),
      agencyId: payload.agencyId,
      kind: "ai_classification",
      actorLabel: "classification pipeline",
      summary: `AI suggested classifications for ${classified.length} imported record(s) — hints only, awaiting a named human`,
      payload: {
        pipeline: "classify_document",
        promptVersion: classifyDocumentPipeline.promptVersion,
        documentIds: classified,
      },
      createdAt: new Date(),
    });
  }
}
