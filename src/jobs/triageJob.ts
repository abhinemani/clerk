/**
 * Intake-triage job (§6.1): runs the pipeline on a freshly filed request and
 * persists the draft via applyTriageDraft — which is exactly the "AI proposes"
 * half. The coordinator's Accept/Edit/Dismiss card disposes of it.
 *
 * No ANTHROPIC_API_KEY → the job quietly skips (the app is fully usable
 * without AI; the scope card simply shows the raw text until staff edit it).
 */
import { getRepository } from "@/db/createRepository";
import { AnthropicModelClient } from "@/ai/modelClient";
import { runPipeline } from "@/ai/runPipeline";
import { clampComplexity, intakeTriagePipeline } from "@/ai/pipelines/intakeTriage";
import { defaultDeps } from "@/services/deps";
import { applyTriageDraft } from "@/services/requestService";
import type { JobPayloads } from "./queue";

export async function runIntakeTriageJob(payload: JobPayloads["intake_triage"]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return; // AI off — nothing to draft

  const repo = await getRepository();
  const request = await repo.getRequest(payload.agencyId, payload.requestId);
  if (!request) return;
  if (request.interpretedScope) return; // already triaged (or staff got there first)

  const result = await runPipeline(intakeTriagePipeline, { rawText: request.rawText }, {
    modelClient: new AnthropicModelClient(apiKey),
  });

  await applyTriageDraft(defaultDeps(repo), {
    agencyId: payload.agencyId,
    requestId: payload.requestId,
    interpretedScope: result.output.interpreted_scope,
    recordTypes: result.output.record_types,
    complexityScore: clampComplexity(result.output.complexity_score),
    promptVersion: intakeTriagePipeline.promptVersion,
    model: result.model,
    redFlags: result.output.statutory_red_flags,
  });
}
