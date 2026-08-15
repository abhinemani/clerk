/**
 * Fulfillment agent (spec §16.1) — the per-request agent that "works a request
 * like a junior clerk."
 *
 * It runs through the real harness (allowlist → tier → budget → append-only
 * events), orchestrating capabilities that do actual work:
 *   read_request → corpus_search (real retriever) → assemble_review_set
 *   → propose_task (routing pipeline) → status_memo
 *
 * Steps share a scratchpad — the agent's accumulating working state — so the
 * memo can summarize what search found and what tasks it proposes. The retriever
 * and model client are injected, so it's testable end-to-end without live infra.
 */
import type { AgentPlanStep } from "@/db/schema";
import { runPipeline } from "@/ai/runPipeline";
import type { ModelClient } from "@/ai/modelClient";
import { routingPipeline, type RoutingOutput } from "@/ai/pipelines/routing";
import type { Candidate, Retriever } from "@/ai/search/retriever";
import type { ServiceDeps } from "@/services/deps";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface FulfillmentInput {
  request: { publicId: string; interpretedScope: string; recordTypes: string[] };
  departments: Array<{ name: string; description?: string }>;
}

export interface FulfillmentDeps {
  retriever: Retriever;
  modelClient: ModelClient;
  agencyId?: string;
  policy?: AgencyActionPolicy;
}

export interface FulfillmentResult {
  memo: string;
  reviewSet: string[];
  candidates: Candidate[];
  assignments: RoutingOutput["assignments"];
  uncovered: string[];
  outcome: string;
  events: AgentActionEvent[];
}

function step(index: number, action: string): AgentPlanStep {
  return { index, description: action, status: "pending", action, input: {} };
}

function cap(name: string, fn: () => unknown | Promise<unknown>): Capability {
  return {
    name: name as never,
    async execute() {
      return { output: await fn(), tokens: 0 };
    },
  };
}

function buildMemo(
  publicId: string,
  candidates: Candidate[],
  reviewSetSize: number,
  routing: RoutingOutput,
): string {
  const top = candidates.slice(0, 3).map((c) => c.title);
  const lines = [
    `Fulfillment plan — ${publicId}`,
    `Found ${candidates.length} likely-responsive record(s) in the corpus${top.length ? `: ${top.join("; ")}` : ""}.`,
    `Assembled a review set of ${reviewSetSize} document(s).`,
    `Proposed ${routing.assignments.length} department task(s)${
      routing.assignments.length ? `: ${routing.assignments.map((a) => a.department).join(", ")}` : ""
    }.`,
  ];
  if (routing.uncovered.length) lines.push(`Not covered by any department: ${routing.uncovered.join("; ")}.`);
  lines.push(
    `Recommendation: ${
      candidates.length
        ? "attach the responsive records to the review set"
        : "no corpus hits — rely on the proposed department tasks"
    }${routing.assignments.length ? " and dispatch the proposed tasks." : "."}`,
  );
  return lines.join("\n");
}

/**
 * The persisted fulfillment agent's capability implementations (v1 — the
 * planner-driven path behind the per-agency flag, docs/agentic-horizon.md).
 *
 * Deadline-agent resumability rule: every capability reads ONLY its step's
 * `input` (embedded at plan time by fulfillmentService) plus injected deps —
 * never a closure over plan-time state — so a run parked at the dispatch_task
 * checkpoint resumes correctly in a later process. Exported for the steering
 * surface's resume path (steering.ts registryFor).
 *
 * Search results are computed at plan time and embedded in the step inputs
 * (the deadline agent's read_queue idiom): the corpus_search step's audit
 * event records exactly what was searched and found; assemble_review_set
 * performs the real attach from the embedded ids.
 */
export function fulfillmentCapabilityRegistry(
  agencyId: string,
  deps?: ServiceDeps,
): MapCapabilityRegistry {
  const capIn = (
    name: string,
    fn: (input: Record<string, unknown>) => Promise<unknown> | unknown,
  ): Capability => ({
    name: name as never,
    async execute(input) {
      return { output: await fn(input), tokens: 0 };
    },
  });

  return new MapCapabilityRegistry([
    capIn("read_request", (i) => ({
      publicId: i.publicId,
      scope: i.scope,
      items: i.items ?? [],
    })),
    capIn("corpus_search", (i) => ({
      label: i.label,
      query: i.query,
      found: i.found ?? 0,
      top: i.top ?? [],
    })),
    // Row-level lookup on top of the plain document match (v2): plan-time
    // findAgencyTabularAnswer results, echoed here purely for the audit trail
    // — the deadline-agent idiom (no fresh IO in the capability itself).
    capIn("connector_search", (i) => ({
      label: i.label,
      dataset: i.dataset ?? null,
      totalRows: i.totalRows ?? 0,
      periods: i.periods ?? [],
      basis: i.basis ?? null,
    })),
    // Per-item review-set curation (v2): one call per scope item that found
    // candidates, so the audit trail — and a coordinator skimming it — can
    // see which item a document is responsive to, not just a flat pile.
    capIn("assemble_review_set", async (i) => {
      const requestId = typeof i.requestId === "string" ? i.requestId : null;
      const itemLabel = typeof i.itemLabel === "string" ? i.itemLabel : null;
      const documentIds = Array.isArray(i.documentIds)
        ? i.documentIds.filter((d): d is string => typeof d === "string")
        : [];
      if (!deps || !requestId || documentIds.length === 0) {
        return { attached: 0, considered: documentIds.length };
      }
      const attached = new Set(
        (await deps.repo.listRequestDocuments(agencyId, requestId)).map((d) => d.id),
      );
      const { holdForOpenRequest } = await import("@/services/retentionService");
      const added: string[] = [];
      for (const documentId of documentIds) {
        if (attached.has(documentId)) continue;
        const doc = await deps.repo.getDocument(agencyId, documentId);
        if (!doc) continue;
        await deps.repo.linkRequestDocument(agencyId, requestId, documentId);
        // Responsive to an open request ⇒ hold against the retention
        // schedule (spoliation rule — same as the staff attach path).
        await holdForOpenRequest(deps, { agencyId, requestId, documentId });
        added.push(doc.filename ?? documentId);
      }
      if (added.length > 0) {
        await deps.repo.appendEvent({
          id: deps.genId(),
          agencyId,
          requestId,
          kind: "note",
          actorUserId: null,
          summary: itemLabel
            ? `Fulfillment agent attached ${added.length} candidate record(s) responsive to "${itemLabel}"`
            : `Fulfillment agent attached ${added.length} candidate record(s) to the review set`,
          payload: { documentIds, added, itemLabel, source: "fulfillment_agent" },
          createdAt: deps.now(),
        });
      }
      return { attached: added.length, considered: documentIds.length, itemLabel };
    }),
    // Mid-run plan revision (v2, §16.1 plan_update): reads the plan-time gap
    // analysis embedded in its input and, when a scope item was a dead end
    // (no corpus hits, no connector data, no department to route to), inserts
    // the already-computed broadened-search steps right after itself. Tier 1
    // — it only grows the plan with more Tier-1 reads; nothing it inserts can
    // itself bypass a checkpoint. (Not built via capIn: it needs to return
    // insertSteps at the top level of CapabilityResult, not nested in output.)
    {
      name: "plan_update" as never,
      async execute(input) {
        const gaps = Array.isArray(input.gaps) ? input.gaps : [];
        const insertSteps = Array.isArray(input.candidateInsertSteps)
          ? (input.candidateInsertSteps as AgentPlanStep[])
          : [];
        return {
          output: { revisedFor: gaps, insertedStepCount: insertSteps.length },
          tokens: 0,
          insertSteps,
        };
      },
    },
    capIn("dispatch_task", async (i) => {
      // Tier 2 — under the default policy the harness parks the run before
      // this ever executes; a named approval (or agency opt-in) releases it.
      if (
        !deps ||
        typeof i.requestId !== "string" ||
        typeof i.scopeText !== "string"
      ) {
        return { dispatched: false, department: i.departmentName ?? null };
      }
      const { dispatchTask } = await import("@/services/taskService");
      const task = await dispatchTask(deps, {
        agencyId,
        requestId: i.requestId,
        departmentId: typeof i.departmentId === "string" ? i.departmentId : undefined,
        departmentName: typeof i.departmentName === "string" ? i.departmentName : undefined,
        departmentEmail: typeof i.departmentEmail === "string" ? i.departmentEmail : undefined,
        scopeText: i.scopeText,
      });
      return { dispatched: true, taskId: task.id, department: i.departmentName ?? null };
    }),
    capIn("status_memo", async (i) => {
      const memo = typeof i.memo === "string" ? i.memo : "";
      if (deps && typeof i.requestId === "string" && memo) {
        await deps.repo.appendEvent({
          id: deps.genId(),
          agencyId,
          requestId: i.requestId,
          kind: "note",
          actorUserId: null,
          summary: "Fulfillment agent status memo",
          payload: { memo, source: "fulfillment_agent" },
          createdAt: deps.now(),
        });
      }
      return { memo };
    }),
  ]);
}

/** Run the fulfillment agent for one request as a real agent execution. */
export async function runFulfillment(
  input: FulfillmentInput,
  deps: FulfillmentDeps,
): Promise<FulfillmentResult> {
  // Shared scratchpad — the agent's working state across steps.
  const scratch: {
    candidates: Candidate[];
    reviewSet: string[];
    routing: RoutingOutput;
    memo: string;
  } = { candidates: [], reviewSet: [], routing: { assignments: [], uncovered: [] }, memo: "" };

  const registry = new MapCapabilityRegistry([
    cap("read_request", () => ({
      publicId: input.request.publicId,
      interpretedScope: input.request.interpretedScope,
      recordTypes: input.request.recordTypes,
    })),
    cap("corpus_search", async () => {
      // Staff-side: full corpus. (Requester-side agents are hard-pinned public.)
      scratch.candidates = await deps.retriever.search(input.request.interpretedScope, { scope: "full", limit: 10 });
      return { count: scratch.candidates.length, top: scratch.candidates.slice(0, 3).map((c) => c.title) };
    }),
    cap("assemble_review_set", () => {
      scratch.reviewSet = scratch.candidates.map((c) => c.id);
      return { size: scratch.reviewSet.length };
    }),
    cap("propose_task", async () => {
      const res = await runPipeline(
        routingPipeline,
        { interpretedScope: input.request.interpretedScope, recordTypes: input.request.recordTypes, departments: input.departments },
        { modelClient: deps.modelClient, agencyId: deps.agencyId, requestId: input.request.publicId },
      );
      scratch.routing = res.output;
      return res.output;
    }),
    cap("status_memo", () => {
      scratch.memo = buildMemo(input.request.publicId, scratch.candidates, scratch.reviewSet.length, scratch.routing);
      return { memo: scratch.memo };
    }),
  ]);

  const steps: AgentPlanStep[] = [
    step(0, "read_request"),
    step(1, "corpus_search"),
    step(2, "assemble_review_set"),
    step(3, "propose_task"),
    step(4, "status_memo"),
  ];

  const run: AgentRunState = {
    id: `fulfillment-${input.request.publicId}`,
    agencyId: deps.agencyId ?? "agency",
    requestId: input.request.publicId,
    status: "planning",
    plan: { goal: `Work request ${input.request.publicId}`, cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("fulfillment"),
    policy: deps.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  return {
    memo: scratch.memo,
    reviewSet: scratch.reviewSet,
    candidates: scratch.candidates,
    assignments: scratch.routing.assignments,
    uncovered: scratch.routing.uncovered,
    outcome: res.outcome,
    events,
  };
}
