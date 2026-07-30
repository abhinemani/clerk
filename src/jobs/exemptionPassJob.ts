/**
 * Exemption-pass job (§6.5 step 2): after records land in a request's review
 * set, run the LLM pass over each extractable document against the agency's
 * configured exemption catalog, and store the findings as suggestions in the
 * document's metadata. The studio renders them alongside the deterministic
 * PII pass — suggestions only; a named human accepts, edits, or rejects.
 *
 * No ANTHROPIC_API_KEY → quietly skips (the PII pass still works).
 */
import { AnthropicModelClient } from "@/ai/modelClient";
import { classifyDocumentPipeline, type ClassifyDocumentOutput } from "@/ai/pipelines/classifyDocument";
import {
  exemptionFindingsToRedactions,
  exemptionPassPipeline,
} from "@/ai/pipelines/exemptionPass";
import { runPipeline } from "@/ai/runPipeline";
import { getRepository } from "@/db/createRepository";
import { getStateProfile } from "@/statute/profiles";
import type { JobPayloads } from "./queue";

export interface StoredExemptionSuggestion {
  line: number;
  startCol: number;
  endCol: number;
  reason: string;
  confidence: number;
  rationale: string;
}

export async function runExemptionPassJob(payload: JobPayloads["exemption_pass"]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  const repo = await getRepository();
  const [agency, docs, departments] = await Promise.all([
    repo.getAgency(payload.agencyId),
    repo.listRequestDocuments(payload.agencyId, payload.requestId),
    repo.listDepartments(payload.agencyId),
  ]);
  if (!agency) return;
  const profile = getStateProfile(agency.stateCode);
  const exemptions = profile?.exemptions.map((e) => `${e.shortLabel} (${e.statuteSection})`) ?? [];
  const modelClient = new AnthropicModelClient(apiKey);

  const pending = docs.filter(
    (d) => d.extractedText != null && !d.externalSystemId?.startsWith("redacted:"), // never burned artifacts
  );

  for (const doc of pending) {
    const meta = (doc.metadata ?? {}) as {
      aiSuggestions?: unknown;
      aiClassification?: unknown;
    };
    const lines = doc.extractedText!.split("\n");
    const metadata: Record<string, unknown> = { ...(doc.metadata ?? {}) };
    let dirty = false;

    // §6.5 step 2 — exemption suggestions for the studio.
    if (meta.aiSuggestions == null && exemptions.length > 0) {
      const result = await runPipeline(exemptionPassPipeline, { lines, exemptions }, { modelClient });
      const suggestions: StoredExemptionSuggestion[] = exemptionFindingsToRedactions(
        lines,
        result.output,
      ).map((s) => ({
        line: s.line,
        startCol: s.startCol,
        endCol: s.endCol,
        reason: s.reason ?? exemptions[0]!,
        confidence: s.confidence,
        rationale: s.rationale,
      }));
      metadata.aiSuggestions = suggestions;
      dirty = true;
      await repo.appendEvent({
        id: crypto.randomUUID(),
        agencyId: payload.agencyId,
        requestId: payload.requestId,
        kind: "ai_action",
        actorUserId: null,
        summary: `Exemption pass suggested ${suggestions.length} redaction(s) on ${doc.filename ?? doc.id}`,
        payload: {
          pipeline: "exemption_pass",
          promptVersion: exemptionPassPipeline.promptVersion,
          model: result.model,
          documentId: doc.id,
          suggestions: suggestions.length,
        },
        createdAt: new Date(),
      });
    }

    // §6.5/§9.3 — auto-classification. Suggestions ONLY: the classification
    // COLUMN is never touched here (invariant 9 — internal→public is a named
    // human's move; the doc arrived internal and stays internal).
    if (meta.aiClassification == null) {
      const result = await runPipeline(
        classifyDocumentPipeline,
        {
          filename: doc.filename ?? undefined,
          text: doc.extractedText!,
          departments: departments.map((d) => d.name),
        },
        { modelClient },
      );
      const c: ClassifyDocumentOutput = result.output;
      metadata.aiClassification = {
        recordType: c.recordType,
        department: c.department,
        suggestedClassification: c.classification,
        suggestedMetadata: c.suggestedMetadata,
        sensitivityNote: c.sensitivityNote,
      };
      dirty = true;
      await repo.appendEvent({
        id: crypto.randomUUID(),
        agencyId: payload.agencyId,
        requestId: payload.requestId,
        kind: "ai_action",
        actorUserId: null,
        summary: `Classified ${doc.filename ?? doc.id} as "${c.recordType}"${c.sensitivityNote ? " (sensitivity flagged)" : ""}`,
        payload: {
          pipeline: "classify_document",
          promptVersion: classifyDocumentPipeline.promptVersion,
          model: result.model,
          documentId: doc.id,
          recordType: c.recordType,
          suggestedClassification: c.classification,
        },
        createdAt: new Date(),
      });
    }

    if (dirty) await repo.updateDocument(payload.agencyId, doc.id, { metadata });
  }
}
