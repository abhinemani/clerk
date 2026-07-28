/**
 * Integration tests for the agent run orchestrator (spec §16.2, §16.3).
 *
 * These drive the four guardrails end-to-end against an in-memory capability
 * registry — no database — proving allowlist enforcement, tier checkpoints,
 * corpus-scope pinning, budget handoff, audit logging, and resumability.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentPlanState, AgentPlanStep } from "@/db/schema";
import { getAgentDefinition, type AgentDefinition } from "./definitions";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { MapCapabilityRegistry, type Capability, type CapabilityContext } from "./tools";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { DEFAULT_ACTION_POLICY, type ActionType } from "./actionTiers";

// --- helpers ---------------------------------------------------------------

function step(index: number, opts: Partial<AgentPlanStep> & { tool?: string; action?: string }): AgentPlanStep {
  return {
    index,
    description: `step ${index}`,
    status: "pending",
    ...opts,
  };
}

function plan(steps: AgentPlanStep[], goal = "test goal"): AgentPlanState {
  return { goal, steps, cursor: 0 };
}

function makeRun(overrides: Partial<AgentRunState> = {}): AgentRunState {
  return {
    id: "run-1",
    agencyId: "agency-1",
    requestId: "req-1",
    status: "planning",
    plan: plan([]),
    budgetLimits: DEFAULT_BUDGET,
    budgetSpend: { ...ZERO_SPEND },
    ...overrides,
  };
}

/** A capability that records its calls and returns a canned output. */
function fake(name: string, tokens = 100): Capability & { calls: CapabilityContext[]; inputs: Record<string, unknown>[] } {
  const calls: CapabilityContext[] = [];
  const inputs: Record<string, unknown>[] = [];
  return {
    name: name as never,
    calls,
    inputs,
    async execute(input, ctx) {
      calls.push(ctx);
      inputs.push(input);
      return { output: `${name}-ok`, tokens };
    },
  };
}

function collector() {
  const events: AgentActionEvent[] = [];
  return { events, emit: (e: AgentActionEvent) => void events.push(e) };
}

// --- tests -----------------------------------------------------------------

describe("happy path — autonomous Tier-1 plan runs to completion", () => {
  it("completes, logs one event per step, and attributes agent-sends", async () => {
    const run = makeRun({
      plan: plan([
        step(0, { tool: "read_request" }),
        step(1, { action: "corpus_search" }),
        step(2, { action: "assemble_review_set" }),
        step(3, { action: "status_memo" }),
      ]),
    });
    const registry = new MapCapabilityRegistry([
      fake("read_request"),
      fake("corpus_search"),
      fake("assemble_review_set"),
      fake("status_memo"),
    ]);
    const { events, emit } = collector();
    const persist = vi.fn();

    const res = await runAgent(run, {
      definition: getAgentDefinition("fulfillment"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit,
      persist,
    });

    expect(res.outcome).toBe("completed");
    expect(run.status).toBe("completed");
    expect(run.plan.cursor).toBe(4);
    expect(run.budgetSpend.toolCalls).toBe(4);
    expect(run.budgetSpend.tokens).toBe(400);

    // One audit event per step, all linked to the run (§16.2).
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.agentRunId === "run-1" && e.kind === "agent_action")).toBe(true);
    // Read tool is not an "agent-send"; Tier-1 actions are attributable sends (§16.3).
    expect(events.map((e) => e.payload.autonomousSend)).toEqual([false, true, true, true]);
    // Plan snapshots recorded for replay/audit.
    expect(events[3]!.payload.planSnapshot.statuses).toEqual(["done", "done", "done", "done"]);
    // Persisted after each of the 4 steps, plus once more on completion.
    expect(persist).toHaveBeenCalledTimes(5);
  });
});

describe("(1) allowlist enforcement", () => {
  it("halts as failed when a step is off the agent's allowlist (§16.2)", async () => {
    const run = makeRun({
      plan: plan([step(0, { action: "publish_release" })]), // not in deadline allowlist
    });
    const { events, emit } = collector();

    const res = await runAgent(run, {
      definition: getAgentDefinition("deadline"),
      policy: DEFAULT_ACTION_POLICY,
      registry: new MapCapabilityRegistry(),
      emit,
    });

    expect(res.outcome).toBe("failed");
    expect(run.status).toBe("failed");
    expect(run.plan.cursor).toBe(0); // parked, not advanced
    expect(run.plan.steps[0]!.status).toBe("blocked");
    expect(res.reason).toMatch(/not in the deadline agent's allowlist/);
    expect(events).toHaveLength(1);
  });
});

describe("(2) tier system — Tier-3 becomes a human checkpoint", () => {
  it("parks release-prep at publish_release without executing it (§16.3)", async () => {
    const run = makeRun({
      plan: plan([
        step(0, { tool: "read_review_set" }),
        step(1, { action: "suggest_redactions" }),
        step(2, { action: "compile_exemption_log" }),
        step(3, { action: "assemble_packet" }),
        step(4, { action: "checksum_packet" }),
        step(5, { action: "publish_release" }), // Tier 3
      ]),
    });
    const publish = fake("publish_release");
    const registry = new MapCapabilityRegistry([
      fake("read_review_set"),
      fake("suggest_redactions"),
      fake("compile_exemption_log"),
      fake("assemble_packet"),
      fake("checksum_packet"),
      publish,
    ]);
    const { events, emit } = collector();

    const res = await runAgent(run, {
      definition: getAgentDefinition("release_prep"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit,
    });

    expect(res.outcome).toBe("awaiting_checkpoint");
    expect(run.status).toBe("awaiting_checkpoint");
    expect(run.plan.cursor).toBe(5); // parked ON the checkpoint step for resume
    expect(run.plan.steps[5]!.status).toBe("awaiting_human");
    expect(publish.calls).toHaveLength(0); // nothing shipped (§16.3)
    // 5 executed-step events + 1 checkpoint event.
    expect(events).toHaveLength(6);
    expect(events.at(-1)!.payload.disposition).toBe("requires_human");
  });

  it("auto-executes an opted-in Tier-2 action, still attributing it as agent-sent", async () => {
    const run = makeRun({
      requestId: undefined, // queue-wide deadline run
      plan: plan([step(0, { action: "send_custodian_nudge_email" })]),
    });
    const registry = new MapCapabilityRegistry([fake("send_custodian_nudge_email")]);
    const { events, emit } = collector();

    const res = await runAgent(run, {
      definition: getAgentDefinition("deadline"),
      policy: { autoSendTier2: ["send_custodian_nudge_email"] as ActionType[] },
      registry,
      emit,
    });

    expect(res.outcome).toBe("completed");
    expect(events[0]!.payload.autonomousSend).toBe(true);
    expect(events[0]!.payload.tier).toBe(2);
  });
});

describe("(2b) forbidden actions halt even if mis-allowlisted (defense in depth)", () => {
  it("blocks a forbidden action as failed (§16.3)", async () => {
    // Construct a deliberately-misconfigured agent that allowlists a forbidden action.
    const rogue: AgentDefinition = {
      ...getAgentDefinition("ingest_steward"),
      allowedCapabilities: new Set([
        ...getAgentDefinition("ingest_steward").allowedCapabilities,
        "reclassify_internal_to_public",
      ]),
    };
    const run = makeRun({
      plan: plan([step(0, { action: "reclassify_internal_to_public" })]),
    });
    const registry = new MapCapabilityRegistry([fake("reclassify_internal_to_public")]);
    const { emit } = collector();

    const res = await runAgent(run, {
      definition: rogue,
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit,
    });

    expect(res.outcome).toBe("failed");
    expect(res.reason).toMatch(/forbidden/);
    expect(run.plan.steps[0]!.status).toBe("blocked");
  });
});

describe("(3) corpus-scope pinning for the requester-side agent", () => {
  it("forces public scope on searches by default", async () => {
    const run = makeRun({
      requestId: undefined,
      plan: plan([step(0, { action: "corpus_search", input: {} })]),
    });
    const search = fake("corpus_search");
    const registry = new MapCapabilityRegistry([search]);
    const { emit } = collector();

    const res = await runAgent(run, {
      definition: getAgentDefinition("requester_side"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit,
    });

    expect(res.outcome).toBe("completed");
    // Scope pinned both on the call input and the capability context (§16.3).
    expect(search.inputs[0]!.corpusScope).toBe("public");
    expect(search.calls[0]!.corpusScope).toBe("public");
  });

  it("hard-fails an attempt to widen scope to the full/internal corpus", async () => {
    const run = makeRun({
      requestId: undefined,
      plan: plan([step(0, { action: "corpus_search", input: { corpusScope: "full" } })]),
    });
    const search = fake("corpus_search");
    const registry = new MapCapabilityRegistry([search]);
    const { emit } = collector();

    const res = await runAgent(run, {
      definition: getAgentDefinition("requester_side"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit,
    });

    expect(res.outcome).toBe("failed");
    expect(res.reason).toMatch(/hard-pinned to the public corpus/);
    expect(search.calls).toHaveLength(0); // never reached the corpus
  });
});

describe("(4) budget exhaustion hands off gracefully", () => {
  it("stops with a handoff note when the tool-call cap is hit (§16.2)", async () => {
    const run = makeRun({
      budgetLimits: { maxToolCalls: 2, maxTokens: 1_000_000, maxWallClockMs: 1_000_000 },
      plan: plan([
        step(0, { action: "corpus_search" }),
        step(1, { action: "corpus_search" }),
        step(2, { action: "assemble_review_set" }),
      ]),
    });
    const registry = new MapCapabilityRegistry([fake("corpus_search"), fake("assemble_review_set")]);
    const { events, emit } = collector();

    const res = await runAgent(run, {
      definition: getAgentDefinition("fulfillment"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit,
    });

    expect(res.outcome).toBe("exhausted");
    expect(run.status).toBe("exhausted");
    expect(run.plan.cursor).toBe(2); // two steps done, parked before the third
    expect(run.handoffNote).toMatch(/tool-call budget after 2\/3/);
    expect(events.at(-1)!.summary).toContain("budget-exhausted");
  });
});

describe("resumability & interruption", () => {
  it("pauses cooperatively and resumes from the cursor (§16.2)", async () => {
    const run = makeRun({
      plan: plan([
        step(0, { action: "corpus_search" }),
        step(1, { action: "assemble_review_set" }),
        step(2, { action: "status_memo" }),
      ]),
    });
    const registry = new MapCapabilityRegistry([
      fake("corpus_search"),
      fake("assemble_review_set"),
      fake("status_memo"),
    ]);
    const deps = {
      definition: getAgentDefinition("fulfillment"),
      policy: DEFAULT_ACTION_POLICY,
      registry,
      emit: () => {},
    };

    // Interrupt before the 2nd step.
    let checks = 0;
    const first = await runAgent(run, {
      ...deps,
      shouldInterrupt: () => ++checks === 2,
    });
    expect(first.outcome).toBe("paused");
    expect(run.plan.cursor).toBe(1);

    // A paused run does nothing until reactivated.
    run.status = "paused";
    const noop = await runAgent(run, deps);
    expect(noop.outcome).toBe("paused");
    expect(run.plan.cursor).toBe(1);

    // Reactivate and finish.
    run.status = "running";
    const second = await runAgent(run, deps);
    expect(second.outcome).toBe("completed");
    expect(run.plan.cursor).toBe(3);
  });
});

describe("missing implementation", () => {
  it("fails clearly when an allowlisted capability has no registered impl", async () => {
    const run = makeRun({ plan: plan([step(0, { tool: "read_request" })]) });
    const { emit } = collector();
    const res = await runAgent(run, {
      definition: getAgentDefinition("fulfillment"),
      policy: DEFAULT_ACTION_POLICY,
      registry: new MapCapabilityRegistry(), // empty
      emit,
    });
    expect(res.outcome).toBe("failed");
    expect(res.reason).toMatch(/No implementation registered/);
  });
});
