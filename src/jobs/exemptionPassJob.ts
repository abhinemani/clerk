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
  const [agency, docs] = await Promise.all([
    repo.getAgency(payload.agencyId),
    repo.listRequestDocuments(payload.agencyId, payload.requestId),
  ]);
  if (!agency) return;
  const profile = getStateProfile(agency.stateCode);
  const exemptions = profile?.exemptions.map((e) => `${e.shortLabel} (${e.statuteSection})`) ?? [];
  if (exemptions.length === 0) return; // nothing to cite against

  const pending = docs.filter(
    (d) =>
      d.extractedText != null &&
      !d.externalSystemId?.startsWith("redacted:") && // never scan burned artifacts
      (d.metadata as { aiSuggestions?: unknown } | null)?.aiSuggestions == null,
  );

  for (const doc of pending) {
    const lines = doc.extractedText!.split("\n");
    const result = await runPipeline(
      exemptionPassPipeline,
      { lines, exemptions },
      { modelClient: new AnthropicModelClient(apiKey) },
    );
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

    await repo.updateDocument(payload.agencyId, doc.id, {
      metadata: { ...(doc.metadata ?? {}), aiSuggestions: suggestions },
    });
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
}
