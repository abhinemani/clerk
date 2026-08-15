/**
 * Fulfillment agent v1/v2 (spec §16.1, HANDOFF candidate #1) — the
 * model-driven planner behind a per-agency flag.
 *
 * A staff member presses "Run fulfillment agent" on a request; this service:
 *   1. checks the agency flag (settings.fulfillmentAgent.enabled — demo
 *      tenant first, off everywhere else),
 *   2. decomposes the interpreted scope via the fulfillment_plan pipeline
 *      (deterministic fallback when no model is available — self-contained
 *      first, the plan degrades rather than the button breaking),
 *   3. runs the corpus search AND the connector (row-level) search for each
 *      scope item AT PLAN TIME and embeds everything into step inputs (the
 *      deadline agent's resumability rule: capabilities read only their
 *      step's input + injected deps),
 *   4. for any scope item that came up completely empty — no corpus hits, no
 *      connector data, no department to route to — pre-computes a broadened
 *      retry and hands it to a `plan_update` step, which inserts it into the
 *      run mid-execution (v2: "plan revision mid-run"),
 *   5. persists the run (agent_runs) and executes it through the real
 *      harness — attach steps run Tier 1, one per scope item that found
 *      candidates (v2: per-item review-set curation, not one flat top-N
 *      list); each department dispatch_task is Tier 2 and PARKS the run at
 *      the /app/agents checkpoint, where a named approval sends exactly that
 *      task (§16.3).
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
  type FulfillmentScopeItem,
} from "@/ai/pipelines/fulfillmentPlan";
import { runPipeline } from "@/ai/runPipeline";
import { fulfillmentCapabilityRegistry } from "@/agents/fulfillmentAgent";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "@/agents/actionTiers";
import { ZERO_SPEND } from "@/agents/budget";
import { getAgentDefinition } from "@/agents/definitions";
import { runAgent, type AgentRunState } from "@/agents/runHarness";
import type { AgentPlanStep } from "@/db/schema";
import type { TabularAnswer } from "@/domain/tabularAnswer";
import type { ServiceDeps } from "./deps";
import { NotFoundError } from "./repository";
import { findAgencyTabularAnswer } from "./agencyTabularAnswer";
import { searchAgencyRecords, type RecordsSearchHit } from "./recordsSearchService";

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
  /** Scope items rescued by a plan_update broadened retry (v2). */
  planRevisionCount: number;
}

const SEARCH_LIMIT_PER_ITEM = 5;
/** Per scope item, not global (v2) — each item curates its own short list
 *  instead of competing for one flat top-N across the whole plan. */
const PER_ITEM_ATTACH_CAP = 5;
const BROADENED_SEARCH_LIMIT = 5;

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

/** One scope item's plan-time findings — corpus, connector, and (if it was a
 *  dead end) the plan_update broadened retry. Kept separate from `candidates`
 *  so the broadened retry's own assemble_review_set step (built inside
 *  gapInsertSteps) is never double-counted against the item's primary one. */
interface PlannedItemResult {
  item: FulfillmentScopeItem;
  hits: RecordsSearchHit[];
  candidates: Map<string, string>; // documentId → filename, THIS item's own attach set
  connector: TabularAnswer | null;
  broadened: { query: string; found: number; candidates: Map<string, string> } | null;
}

/** Staff-only summary line — deliberately NOT the shared TabularAnswer.basis
 *  string, which says "published slice(s)" (true for the public path, false
 *  here: connector_search reads every classification). */
function connectorBasis(a: TabularAnswer): string {
  const slices = a.periods.length > 0 ? ` across ${a.periods.length} synced slice(s)` : "";
  return `${a.totalRows} row${a.totalRows === 1 ? "" : "s"} of "${a.title}" (${a.sourceName})${slices} — staff preview across every classification, synced ${a.syncedAt.slice(0, 10)}.`;
}

function buildMemo(
  publicId: string,
  plan: FulfillmentPlanOutput,
  results: PlannedItemResult[],
  taskSteps: number,
): string {
  const lines = [`Fulfillment plan — ${publicId}`, `${plan.scope_items.length} scope item(s):`];
  let gapCount = 0;
  for (const r of results) {
    lines.push(`  • ${r.item.label}${r.item.department ? ` → ${r.item.department}` : ""} — ${r.item.rationale}`);
    const bits: string[] = [
      r.candidates.size > 0 ? `${r.candidates.size} candidate record(s) attached` : "no corpus hits",
    ];
    if (r.connector) bits.push(`connector data: ${connectorBasis(r.connector)}`);
    if (r.broadened) {
      gapCount++;
      bits.push(
        r.broadened.candidates.size > 0
          ? `plan revision: broadened retry ("${r.broadened.query}") found ${r.broadened.candidates.size} more`
          : `plan revision: broadened retry ("${r.broadened.query}") found nothing either`,
      );
    }
    lines.push(`      ${bits.join("; ")}`);
  }
  lines.push(
    taskSteps > 0
      ? `${taskSteps} department task(s) planned — Tier 2: each waits for a named approval on /app/agents unless auto-send is opted in.`
      : `No department tasks planned.`,
  );
  if (gapCount > 0) {
    lines.push(
      `Plan revision: ${gapCount} scope item(s) had no leads at all (no corpus hits, no connector data, no department) — the agent revised its own plan mid-run with a broadened retry search for each.`,
    );
  }
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

  // Plan-time corpus + connector search, embedded into step inputs
  // (resumability rule) — one PlannedItemResult per scope item, curated
  // independently (v2 per-item review-set curation, not one flat top-N list).
  const attachedIds = new Set(alreadyAttached.map((d) => d.id));
  const considered = new Set(attachedIds); // grows as items claim candidates, so nothing is attached twice
  const results: PlannedItemResult[] = [];
  for (const item of plan.scope_items) {
    const hits = await searchAgencyRecords(deps, {
      agencyId: input.agencyId,
      query: item.search_query,
      limit: SEARCH_LIMIT_PER_ITEM,
      forRequestId: input.requestId,
    });
    const candidates = new Map<string, string>();
    for (const h of hits) {
      if (candidates.size >= PER_ITEM_ATTACH_CAP) break;
      if (h.alreadyAttached || considered.has(h.documentId)) continue;
      candidates.set(h.documentId, h.filename);
      considered.add(h.documentId);
    }
    // connector_search (v2): row-level lookup when the hits point at a
    // connected dataset — same ambiguity/window rules as the requester-facing
    // tabular answer, just staff-scoped (see agencyTabularAnswer.ts).
    const connector = await findAgencyTabularAnswer(deps, {
      agencyId: input.agencyId,
      query: item.search_query,
      items: hits.map((h) => ({ connectedSource: h.connectedSource })),
    });
    results.push({ item, hits, candidates, connector, broadened: null });
  }

  // plan_update (v2 "plan revision mid-run"): items with NO leads anywhere —
  // no corpus hits, no connector data, and no department to fall back on —
  // get a broadened retry, pre-computed now (deadline-agent idiom: the
  // plan_update capability itself never does fresh IO, it only decides
  // whether to splice in what's already been found). The retry's steps are
  // NOT in the static plan; the plan_update step inserts them mid-run.
  const gapInsertSteps: AgentPlanStep[] = [];
  for (const r of results) {
    if (r.item.department || r.candidates.size > 0 || r.connector) continue;
    const broadenedQuery = (r.item.record_type ?? r.item.label).trim();
    if (!broadenedQuery) continue;
    const broadHits = await searchAgencyRecords(deps, {
      agencyId: input.agencyId,
      query: broadenedQuery,
      limit: BROADENED_SEARCH_LIMIT,
      forRequestId: input.requestId,
    });
    const broadCandidates = new Map<string, string>();
    for (const h of broadHits) {
      if (broadCandidates.size >= PER_ITEM_ATTACH_CAP) break;
      if (h.alreadyAttached || considered.has(h.documentId)) continue;
      broadCandidates.set(h.documentId, h.filename);
      considered.add(h.documentId);
    }
    r.broadened = { query: broadenedQuery, found: broadHits.length, candidates: broadCandidates };

    const retryLabel = `${r.item.label} — broadened retry`;
    gapInsertSteps.push(
      step(0, "corpus_search", {
        publicId: request.publicId,
        label: retryLabel,
        query: broadenedQuery,
        found: broadHits.length,
        top: broadHits.slice(0, 3).map((h) => h.filename),
      }),
    );
    if (broadCandidates.size > 0) {
      gapInsertSteps.push(
        step(0, "assemble_review_set", {
          publicId: request.publicId,
          requestId: request.id,
          itemLabel: retryLabel,
          documentIds: [...broadCandidates.keys()],
          filenames: [...broadCandidates.values()],
        }),
      );
    }
  }
  const gapCount = results.filter((r) => r.broadened != null).length;

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

  const memo = buildMemo(request.publicId, plan, results, taskItems.length);

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
  for (const r of results) {
    steps.push(
      step(idx++, "corpus_search", {
        publicId: request.publicId,
        label: r.item.label,
        query: r.item.search_query,
        found: r.hits.length,
        top: r.hits.slice(0, 3).map((h) => h.filename),
      }),
    );
  }
  for (const r of results) {
    if (!r.connector) continue;
    steps.push(
      step(idx++, "connector_search", {
        publicId: request.publicId,
        label: r.item.label,
        dataset: r.connector.dataset,
        totalRows: r.connector.totalRows,
        periods: r.connector.periods,
        basis: connectorBasis(r.connector),
      }),
    );
  }
  if (gapInsertSteps.length > 0) {
    steps.push(
      step(idx++, "plan_update", {
        publicId: request.publicId,
        gaps: results.filter((r) => r.broadened != null).map((r) => r.item.label),
        candidateInsertSteps: gapInsertSteps,
      }),
    );
  }
  for (const r of results) {
    // Only the item's own PRIMARY candidates — a broadened retry's
    // candidates ride their own assemble_review_set step, inserted mid-run
    // by plan_update, so they never compete with the static plan for a slot.
    if (r.candidates.size === 0) continue;
    steps.push(
      step(idx++, "assemble_review_set", {
        publicId: request.publicId,
        requestId: request.id,
        itemLabel: r.item.label,
        documentIds: [...r.candidates.keys()],
        filenames: [...r.candidates.values()],
      }),
    );
  }
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

  const candidateCount = results.reduce(
    (sum, r) => sum + r.candidates.size + (r.broadened?.candidates.size ?? 0),
    0,
  );

  return {
    runId,
    outcome: result.outcome,
    parked: result.outcome === "awaiting_checkpoint",
    itemCount: plan.scope_items.length,
    candidateCount,
    taskStepCount: taskItems.length,
    usedFallbackPlan: usedFallback,
    planRevisionCount: gapCount,
  };
}
