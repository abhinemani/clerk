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
import { routingPipeline } from "@/ai/pipelines/routing";
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

  const modelClient = new AnthropicModelClient(apiKey);
  const result = await runPipeline(intakeTriagePipeline, { rawText: request.rawText }, {
    modelClient,
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

  // Routing suggestions (§6.3) ride the same job: propose which departments
  // hold the records, with a drafted per-department scope. Stored as an
  // ai_action event; the detail page renders the latest one as proposal
  // cards, and the coordinator's dispatch is still the only thing that acts.
  try {
    const departments = await repo.listDepartments(payload.agencyId);
    if (departments.length === 0) return;
    const routing = await runPipeline(
      routingPipeline,
      {
        interpretedScope: result.output.interpreted_scope,
        recordTypes: result.output.record_types,
        departments: departments.map((d) => ({ name: d.name })),
      },
      { modelClient },
    );
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));
    const suggestions = routing.output.assignments
      .map((a) => ({
        departmentId: deptByName.get(a.department.toLowerCase()) ?? null,
        department: a.department,
        scope: a.scope,
        rationale: a.rationale,
      }))
      .filter((a) => a.departmentId != null);
    await repo.appendEvent({
      id: crypto.randomUUID(),
      agencyId: payload.agencyId,
      requestId: payload.requestId,
      kind: "ai_action",
      actorUserId: null,
      summary: `Routing suggested ${suggestions.length} department(s)`,
      payload: {
        pipeline: "routing_suggestions",
        promptVersion: routingPipeline.promptVersion,
        model: routing.model,
        suggestions,
        uncovered: routing.output.uncovered,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    // Routing is a bonus draft — a failure must not undo the triage above.
    console.error("[jobs] routing suggestions failed", err);
  }
}
