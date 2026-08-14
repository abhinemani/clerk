/**
 * Intake-triage job (§6.1): runs the pipeline on a freshly filed request and
 * persists the draft via applyTriageDraft — which is exactly the "AI proposes"
 * half. The coordinator's Accept/Edit/Dismiss card disposes of it.
 *
 * No ANTHROPIC_API_KEY → the job quietly skips (the app is fully usable
 * without AI; the scope card simply shows the raw text until staff edit it).
 */
import { getRepository } from "@/db/createRepository";
import { AnthropicModelClient, type ModelClient } from "@/ai/modelClient";
import { runPipeline } from "@/ai/runPipeline";
import { clampComplexity, intakeTriagePipeline } from "@/ai/pipelines/intakeTriage";
import { routingPipeline } from "@/ai/pipelines/routing";
import { custodianProposals, custodianSuggestPipeline } from "@/ai/pipelines/custodianSuggest";
import { defaultDeps } from "@/services/deps";
import { applyTriageDraft } from "@/services/requestService";
import type { Repository } from "@/services/repository";
import type { ResolvedPrecedent } from "@/services/similarRequestsService";
import type { JobPayloads } from "./queue";

export async function runIntakeTriageJob(payload: JobPayloads["intake_triage"]): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return; // AI off — nothing to draft

  const repo = await getRepository();
  const request = await repo.getRequest(payload.agencyId, payload.requestId);
  if (!request) return;
  if (request.interpretedScope) return; // already triaged (or staff got there first)

  const modelClient = new AnthropicModelClient(apiKey);

  // RAG'd triage (docs/answer-first.md phase 4): the k nearest resolved
  // requests ride along as calibration context. Best-effort — precedent
  // retrieval failing must never stop intake, so triage degrades to the
  // phase-3 behavior (empty context) rather than erroring.
  let precedents: ResolvedPrecedent[] = [];
  try {
    const { findResolvedPrecedents } = await import("@/services/similarRequestsService");
    precedents = await findResolvedPrecedents(defaultDeps(repo), {
      agencyId: payload.agencyId,
      text: request.rawText,
      excludeRequestId: request.id,
    });
  } catch (e) {
    console.error("[jobs] precedent retrieval failed — triage proceeds without", e);
  }

  // Learning-loop v2: the matched play's aggregate stats ride the prompt as
  // structured calibration (docs/learning-loop.md). Same best-effort posture
  // as precedents — a plays failure degrades, never blocks.
  let play: import("@/ai/prompts/intakeTriage").PromptPlayContext | undefined;
  let playTopic: string | undefined;
  try {
    const { consultPlays } = await import("@/services/learningService");
    const match = await consultPlays(defaultDeps(repo), {
      agencyId: payload.agencyId,
      text: request.rawText,
      requestId: request.id,
    });
    if (match) {
      const { stats } = match.play;
      const top = stats.routes[0];
      play = {
        topic: match.play.topic,
        episodeCount: match.play.episodeCount,
        topRoute: top ? { department: top.department, sharePct: Math.round(top.share * 100) } : null,
        medianDaysToClose: stats.medianDaysToClose,
        extensionRatePct: Math.round(stats.extensionRate * 100),
        exemptions: stats.exemptions.slice(0, 3).map((e) => e.label),
      };
      playTopic = match.play.topic;
    }
  } catch (e) {
    console.error("[jobs] play context lookup failed — triage proceeds without", e);
  }

  const result = await runPipeline(
    intakeTriagePipeline,
    { rawText: request.rawText, precedents, play },
    { modelClient },
  );

  await applyTriageDraft(defaultDeps(repo), {
    agencyId: payload.agencyId,
    requestId: payload.requestId,
    interpretedScope: result.output.interpreted_scope,
    recordTypes: result.output.record_types,
    complexityScore: clampComplexity(result.output.complexity_score),
    promptVersion: intakeTriagePipeline.promptVersion,
    model: result.model,
    redFlags: result.output.statutory_red_flags,
    // Which precedents the model saw — auditability for a grounded draft.
    precedentPublicIds: precedents.map((p) => p.publicId),
    playTopic,
  });

  const triaged = {
    interpretedScope: result.output.interpreted_scope,
    recordTypes: result.output.record_types,
  };

  // Two more drafts ride this job, each isolated: a failure in either must not
  // undo the triage above, and neither must starve the other.
  await suggestRouting(repo, modelClient, payload, triaged, precedents);
  await suggestCustodian(repo, modelClient, payload, triaged);
}

/**
 * Routing suggestions (§6.3): propose which departments hold the records, with
 * a drafted per-department scope. Stored as an ai_action event; the detail page
 * renders the latest one as proposal cards, and the coordinator's dispatch is
 * still the only thing that acts.
 */
async function suggestRouting(
  repo: Repository,
  modelClient: ModelClient,
  payload: JobPayloads["intake_triage"],
  triaged: { interpretedScope: string; recordTypes: string[] },
  precedents: ResolvedPrecedent[] = [],
): Promise<void> {
  try {
    const departments = await repo.listDepartments(payload.agencyId);
    if (departments.length === 0) return;
    const routing = await runPipeline(
      routingPipeline,
      {
        interpretedScope: triaged.interpretedScope,
        recordTypes: triaged.recordTypes,
        departments: departments.map((d) => ({ name: d.name })),
        // Custodian evidence: which departments fulfilled similar requests.
        precedents,
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
        // Clamp on read — the schema carries no numeric bounds (see routing.ts),
        // and an out-of-range confidence must not sail past auto-dispatch's gate.
        confidence: Math.min(1, Math.max(0, a.confidence)),
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
        ...(precedents.length ? { precedents: precedents.map((p) => p.publicId) } : {}),
      },
      createdAt: new Date(),
    });

    // Opt-in auto-dispatch (agency workflowSettings): high-confidence
    // suggestions go out unattended; the rest stay proposal cards.
    const { autoDispatchSuggestions } = await import("@/services/taskService");
    await autoDispatchSuggestions(defaultDeps(repo), {
      agencyId: payload.agencyId,
      requestId: payload.requestId,
      suggestions: suggestions.map((s) => ({
        departmentId: s.departmentId!,
        department: s.department,
        scope: s.scope,
        confidence: s.confidence,
      })),
    });
  } catch (err) {
    // Routing is a bonus draft — a failure must not undo the triage above.
    console.error("[jobs] routing suggestions failed", err);
  }
}

/**
 * Custodian suggestion (inter-agency referral, phase 2): when the records look
 * like another body's, name that body while the clock is still young. Stored as
 * an ai_action event the detail page reads back into the Refer panel.
 *
 * There is deliberately no auto-refer counterpart to auto-dispatch. Dispatch is
 * internal; a referral closes the request and writes to the resident, so it
 * stays a named human's act (invariant 4).
 */
async function suggestCustodian(
  repo: Repository,
  modelClient: ModelClient,
  payload: JobPayloads["intake_triage"],
  triaged: { interpretedScope: string; recordTypes: string[] },
): Promise<void> {
  try {
    const [directory, agency] = await Promise.all([
      repo.listDirectory(payload.agencyId),
      repo.getAgency(payload.agencyId),
    ]);
    // Nobody to refer to — asking the model "is this ours?" with no alternative
    // is just an invitation to invent one.
    if (directory.length === 0 || !agency) return;

    const custodian = await runPipeline(
      custodianSuggestPipeline,
      {
        interpretedScope: triaged.interpretedScope,
        recordTypes: triaged.recordTypes,
        agencyName: agency.name,
        directory: directory.map((d) => ({
          id: d.id,
          name: d.name,
          recordTypes: d.recordTypes,
          notes: d.notes ?? undefined,
        })),
      },
      { modelClient },
    );

    const proposals = custodianProposals(custodian.output, directory);
    if (proposals.length === 0) return; // "ours" is the common case; don't log noise

    await repo.appendEvent({
      id: crypto.randomUUID(),
      agencyId: payload.agencyId,
      requestId: payload.requestId,
      kind: "ai_action",
      actorUserId: null,
      summary: `Possible wrong custodian — suggested ${proposals[0]!.name}`,
      payload: {
        pipeline: "custodian_suggest",
        promptVersion: custodianSuggestPipeline.promptVersion,
        model: custodian.model,
        proposals,
      },
      createdAt: new Date(),
    });
  } catch (err) {
    // Same rule as routing: a bonus draft never breaks intake.
    console.error("[jobs] custodian suggestion failed", err);
  }
}
