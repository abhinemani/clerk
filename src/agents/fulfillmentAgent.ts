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
