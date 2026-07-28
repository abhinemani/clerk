/** Tests for capability wiring — pipelines behind the agent registry (spec §16.2). */
import { describe, expect, it, vi } from "vitest";
import { FakeModelClient } from "@/ai/modelClient";
import type { RoutingOutput } from "@/ai/pipelines/routing";
import { buildCapabilityRegistry } from "./capabilities";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { DEFAULT_ACTION_POLICY } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import type { AgentPlanStep } from "@/db/schema";

const routing: RoutingOutput = {
  assignments: [{ department: "Public Works", scope: "Inspection reports.", rationale: "holds them" }],
  uncovered: [],
};

describe("buildCapabilityRegistry", () => {
  it("registers pipeline-backed and deterministic capabilities", () => {
    const reg = buildCapabilityRegistry({ modelClient: new FakeModelClient([routing]) });
    expect(reg.has("propose_task")).toBe(true);
    expect(reg.has("draft_message")).toBe(true);
    expect(reg.has("suggest_redactions")).toBe(true);
    // Corpus search only when an implementation is injected.
    expect(reg.has("corpus_search")).toBe(false);
  });

  it("adds corpus_search / connector_search when a search impl is provided", () => {
    const reg = buildCapabilityRegistry({
      modelClient: new FakeModelClient([]),
      corpusSearch: async () => ({ output: [], tokens: 0 }),
    });
    expect(reg.has("corpus_search")).toBe(true);
    expect(reg.has("connector_search")).toBe(true);
  });

  it("runs the deterministic PII pass with no model call", async () => {
    const reg = buildCapabilityRegistry({ modelClient: new FakeModelClient([]) });
    const cap = reg.get("suggest_redactions")!;
    const res = await cap.execute(
      { text: "SSN 123-45-6789 and a@b.com" },
      { agencyId: "ag-1", agentRunId: "run-1" },
    );
    const out = res.output as { summary: Record<string, number> };
    expect(out.summary.ssn).toBe(1);
    expect(res.tokens).toBe(0);
  });

  it("runs a pipeline capability and reports token usage", async () => {
    const onPipelineRun = vi.fn();
    const reg = buildCapabilityRegistry({ modelClient: new FakeModelClient([routing]), onPipelineRun });
    const cap = reg.get("propose_task")!;
    const res = await cap.execute(
      { interpretedScope: "s", recordTypes: [], departments: [{ name: "Public Works" }] },
      { agencyId: "ag-1", agentRunId: "run-1", requestId: "req-1" },
    );
    expect((res.output as RoutingOutput).assignments[0]!.department).toBe("Public Works");
    expect(res.tokens).toBeGreaterThan(0);
    expect(onPipelineRun).toHaveBeenCalledWith(expect.objectContaining({ pipeline: "routing_suggestions", ok: true }));
  });
});

// End-to-end: an agent orchestrates a real pipeline through the harness.
describe("agent + capability integration", () => {
  function step(index: number, action: string, input: Record<string, unknown>): AgentPlanStep {
    return { index, description: action, status: "pending", action, input };
  }

  it("fulfillment agent executes propose_task via the wired registry", async () => {
    const registry = buildCapabilityRegistry({ modelClient: new FakeModelClient([routing]) });
    const run: AgentRunState = {
      id: "run-1",
      agencyId: "ag-1",
      requestId: "req-1",
      status: "planning",
      plan: {
        goal: "route the request",
        cursor: 0,
        steps: [step(0, "propose_task", { interpretedScope: "s", recordTypes: [], departments: [{ name: "Public Works" }] })],
      },
      budgetLimits: DEFAULT_BUDGET,
      budgetSpend: { ...ZERO_SPEND },
    };
    const events: AgentActionEvent[] = [];

    const res = await runAgent(run, {
      definition: getAgentDefinition("fulfillment"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit: (e) => void events.push(e),
    });

    expect(res.outcome).toBe("completed");
    expect(run.plan.steps[0]!.status).toBe("done");
    // The propose_task output flowed back onto the plan step.
    const out = run.plan.steps[0]!.output as RoutingOutput;
    expect(out.assignments[0]!.department).toBe("Public Works");
    // Tokens were spent and the step was attributed as an agent action.
    expect(run.budgetSpend.tokens).toBeGreaterThan(0);
    expect(events.at(-1)!.payload.autonomousSend).toBe(true);
  });
});
