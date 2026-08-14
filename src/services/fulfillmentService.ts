/**
 * Fulfillment agent v1 (spec §16.1, HANDOFF candidate #1) — the model-driven
 * planner behind a per-agency flag.
 *
 * A staff member presses "Run fulfillment agent" on a request; this service:
 *   1. checks the agency flag (settings.fulfillmentAgent.enabled — demo
 *      tenant first, off everywhere else),
 *   2. decomposes the interpreted scope via the fulfillment_plan pipeline
 *      (deterministic fallback when no model is available — self-contained
 *      first, the plan degrades rather than the button breaking),
 *   3. runs the corpus search for each scope item AT PLAN TIME and embeds
 *      everything into step inputs (the deadline agent's resumability rule:
 *      capabilities read only their step's input + injected deps),
 *   4. persists the run (agent_runs) and executes it through the real
 *      harness — attach steps run Tier 1; each department dispatch_task is
 *      Tier 2 and PARKS the run at the /app/agents checkpoint, where a named
 *      approval sends exactly that task (§16.3).
 *
 * The agent proposes and assembles; it cannot release, deny, redact, or send
 * requester-facing anything — those actions aren't in its allowlist, and the
 * tier system would park or refuse them if they were.
 */
import { AnthropicModelClient, type ModelClient } from "@/ai/modelClient";
import {
  clampFulfillmentPlan,
  fallbackFulfillmentPlan,
  fulfillmentPlanPipeline,
  type FulfillmentPlanOutput,
} from "@/ai/pipelines/fulfillmentPlan";
import { runPipeline } from "@/ai/runPipeline";
import { fulfillmentCapabilityRegistry } from "@/agents/fulfillmentAgent";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "@/agents/actionTiers";
import { ZERO_SPEND } from "@/agents/budget";
import { getAgentDefinition } from "@/agents/definitions";
import { runAgent, type AgentRunState } from "@/agents/runHarness";
import type { AgentPlanStep } from "@/db/schema";
import type { ServiceDeps } from "./deps";
import { NotFoundError } from "./repository";
import { searchAgencyRecords } from "./recordsSearchService";

export class FulfillmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FulfillmentError";
  }
}

export interface FulfillmentRunSummary {
  runId: string;
  outcome: string;
  /** True when the run parked at the dispatch_task checkpoint (§16.3). */
  parked: boolean;
  itemCount: number;
  candidateCount: number;
  taskStepCount: number;
  usedFallbackPlan: boolean;
}

const SEARCH_LIMIT_PER_ITEM = 5;
const ATTACH_CAP = 12;

function step(
  index: number,
  name: string,
  input: Record<string, unknown>,
  isTool = false,
): AgentPlanStep {
  return isTool
    ? { index, description: name, status: "pending", tool: name, input }
    : { index, description: name, status: "pending", action: name, input };
}

/** Resolve the plan: pipeline when a model is reachable, else the fallback. */
async function resolvePlan(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    requestId: string;
    interpretedScope: string;
    rawText: string;
    recordTypes: string[];
    departments: Array<{ name: string; description?: string }>;
    modelClient?: ModelClient;
  },
): Promise<{ plan: FulfillmentPlanOutput; usedFallback: boolean }> {
  const client =
    input.modelClient ??
    (process.env.ANTHROPIC_API_KEY ? new AnthropicModelClient() : undefined);
  if (client) {
    try {
      const res = await runPipeline(
        fulfillmentPlanPipeline,
        {
          interpretedScope: input.interpretedScope,
          rawText: input.rawText,
          recordTypes: input.recordTypes,
          departments: input.departments,
        },
        {
          modelClient: client,
          agencyId: input.agencyId,
          requestId: input.requestId,
          // AI provenance (invariant 10): the planning run lands in the
          // request's audit trail with model + prompt version.
          onRun: async (record) => {
            await deps.repo.appendEvent({
              id: deps.genId(),
              agencyId: input.agencyId,
              requestId: input.requestId,
              kind: "ai_action",
              actorUserId: null,
              summary: `AI drafted a fulfillment plan (${record.pipeline} ${record.promptVersion})`,
              payload: { ...record },
              createdAt: deps.now(),
            });
          },
        },
      );
      return { plan: clampFulfillmentPlan(res.output, input.departments), usedFallback: false };
    } catch (e) {
      console.error("[fulfillment] planner pipeline failed — using fallback plan", e);
    }
  }
  return {
    plan: fallbackFulfillmentPlan({
      interpretedScope: input.interpretedScope,
      recordTypes: input.recordTypes,
    }),
    usedFallback: true,
  };
}

function buildMemo(
  publicId: string,
  plan: FulfillmentPlanOutput,
  candidateCount: number,
  taskSteps: number,
): string {
  const lines = [
    `Fulfillment plan — ${publicId}`,
    `${plan.scope_items.length} scope item(s):`,
    ...plan.scope_items.map(
      (i) =>
        `  • ${i.label}${i.department ? ` → ${i.department}` : ""} — ${i.rationale}`,
    ),
    `Corpus search found ${candidateCount} candidate record(s); the attach step adds them to the review set for human review.`,
    taskSteps > 0
      ? `${taskSteps} department task(s) planned — Tier 2: each waits for a named approval on /app/agents unless auto-send is opted in.`
      : `No department tasks planned.`,
  ];
  if (plan.memo_note) lines.push(`Planner note: ${plan.memo_note}`);
  return lines.join("\n");
}

/** Start (and run to its first stopping point) a fulfillment agent run. */
export async function startFulfillmentRun(
  deps: ServiceDeps,
  input: {
    agencyId: string;
    requestId: string;
    actorUserId: string;
    modelClient?: ModelClient;
    policy?: AgencyActionPolicy;
  },
): Promise<FulfillmentRunSummary> {
  const { repo } = deps;
  const [agency, request] = await Promise.all([
    repo.getAgency(input.agencyId),
    repo.getRequest(input.agencyId, input.requestId),
  ]);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (agency.settings?.fulfillmentAgent?.enabled !== true) {
    throw new FulfillmentError(
      "The fulfillment agent is not enabled for this agency (Admin → Fulfillment agent).",
    );
  }
  if (request.closedAt != null) {
    throw new FulfillmentError("This request is closed — nothing to fulfill.");
  }

  const interpretedScope = request.interpretedScope?.trim() || request.rawText;
  const [departments, existingTasks, alreadyAttached] = await Promise.all([
    repo.listDepartments(input.agencyId),
    repo.listTasks(input.agencyId, input.requestId),
    repo.listRequestDocuments(input.agencyId, input.requestId),
  ]);

  const { plan, usedFallback } = await resolvePlan(deps, {
    agencyId: input.agencyId,
    requestId: input.requestId,
    interpretedScope,
    rawText: request.rawText,
    recordTypes: request.recordTypes,
    departments: departments.map((d) => ({ name: d.name })),
    modelClient: input.modelClient,
  });
  if (plan.scope_items.length === 0) {
    throw new FulfillmentError("The planner produced no workable scope items.");
  }

  // Plan-time corpus search, embedded into step inputs (resumability rule).
  const attachedIds = new Set(alreadyAttached.map((d) => d.id));
  const candidates = new Map<string, string>(); // id → filename
  const searches: Array<{ label: string; query: string; found: number; top: string[] }> = [];
  for (const item of plan.scope_items) {
    const hits = await searchAgencyRecords(deps, {
      agencyId: input.agencyId,
      query: item.search_query,
      limit: SEARCH_LIMIT_PER_ITEM,
      forRequestId: input.requestId,
    });
    searches.push({
      label: item.label,
      query: item.search_query,
      found: hits.length,
      top: hits.slice(0, 3).map((h) => h.filename),
    });
    for (const h of hits) {
      if (!h.alreadyAttached && !attachedIds.has(h.documentId) && candidates.size < ATTACH_CAP) {
        candidates.set(h.documentId, h.filename);
      }
    }
  }

  // Department tasks — only for planner-routed items whose department exists,
  // has a responder email, and is not already tasked on this request.
  const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d]));
  const taskedDeptIds = new Set(
    existingTasks
      .filter((t) => t.status !== "cancelled")
      .map((t) => t.departmentId)
      .filter((d): d is string => d != null),
  );
  const taskItems = plan.scope_items.flatMap((item) => {
    if (!item.department || !item.task_scope) return [];
    const dept = deptByName.get(item.department.toLowerCase());
    if (!dept || taskedDeptIds.has(dept.id)) return [];
    taskedDeptIds.add(dept.id); // one task per department per run
    return [
      {
        label: item.label,
        departmentId: dept.id,
        departmentName: dept.name,
        departmentEmail: dept.defaultResponderEmails?.[0],
        scopeText: item.task_scope,
      },
    ];
  });

  const memo = buildMemo(request.publicId, plan, candidates.size, taskItems.length);

  // Build the plan steps — everything a capability needs rides in its input.
  const steps: AgentPlanStep[] = [];
  let idx = 0;
  steps.push(
    step(
      idx++,
      "read_request",
      {
        publicId: request.publicId,
        scope: interpretedScope,
        items: plan.scope_items.map((i) => i.label),
        usedFallbackPlan: usedFallback,
      },
      true,
    ),
  );
  for (const s of searches) steps.push(step(idx++, "corpus_search", { publicId: request.publicId, ...s }));
  steps.push(
    step(idx++, "assemble_review_set", {
      publicId: request.publicId,
      requestId: request.id,
      documentIds: [...candidates.keys()],
      filenames: [...candidates.values()],
    }),
  );
  for (const t of taskItems) {
    steps.push(
      step(idx++, "dispatch_task", {
        publicId: request.publicId,
        requestId: request.id,
        departmentId: t.departmentId,
        departmentName: t.departmentName,
        departmentEmail: t.departmentEmail,
        scopeText: t.scopeText,
        label: t.label,
      }),
    );
  }
  steps.push(step(idx++, "status_memo", { publicId: request.publicId, requestId: request.id, memo }));

  // Persist the run so /app/agents can show, approve, and resume it (§16.2).
  const runId = deps.genId();
  const definition = getAgentDefinition("fulfillment");
  await repo.createAgentRun({
    id: runId,
    agencyId: input.agencyId,
    agentType: "fulfillment",
    requestId: request.id,
    status: "planning",
    goal: `Work request ${request.publicId}`,
    plan: { goal: `Work request ${request.publicId}`, cursor: 0, steps },
    budgetLimits: { ...definition.defaultBudget },
    budgetSpend: { ...ZERO_SPEND },
    startedByUserId: input.actorUserId,
    handoffNote: null,
    lastStepAt: null,
    createdAt: deps.now(),
  });
  const persistRun = async (r: AgentRunState) => {
    await repo.updateAgentRun(input.agencyId, runId, {
      status: r.status,
      plan: r.plan,
      budgetSpend: r.budgetSpend,
      handoffNote: r.handoffNote ?? null,
      lastStepAt: r.lastStepAt ?? null,
    });
  };

  const run: AgentRunState = {
    id: runId,
    agencyId: input.agencyId,
    requestId: request.id,
    status: "planning",
    plan: { goal: `Work request ${request.publicId}`, cursor: 0, steps },
    budgetLimits: { ...definition.defaultBudget },
    budgetSpend: { ...ZERO_SPEND },
  };

  const result = await runAgent(run, {
    definition,
    policy: input.policy ?? DEFAULT_ACTION_POLICY,
    registry: fulfillmentCapabilityRegistry(input.agencyId, deps),
    // Every step lands in the request's append-only trail (§16.2).
    emit: async (e) => {
      await repo.appendEvent({
        id: deps.genId(),
        agencyId: input.agencyId,
        requestId: request.id,
        kind: "agent_action",
        actorUserId: null,
        summary: `Fulfillment agent: ${e.summary}`,
        payload: { ...e.payload, runId },
        createdAt: deps.now(),
      });
    },
    persist: persistRun,
    now: () => deps.now().getTime(),
  });
  await persistRun(result.run);

  return {
    runId,
    outcome: result.outcome,
    parked: result.outcome === "awaiting_checkpoint",
    itemCount: plan.scope_items.length,
    candidateCount: candidates.size,
    taskStepCount: taskItems.length,
    usedFallbackPlan: usedFallback,
  };
}
