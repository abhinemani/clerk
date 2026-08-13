/**
 * Agent run orchestrator (spec §16.2, §16.3).
 *
 * Executes an agent's plan one step at a time, enforcing — in this order — the
 * four guardrails that make autonomy safe:
 *
 *   1. Allowlist    — the step's capability must be in the agent's tool surface,
 *                     else it is misbehavior and the run halts (§16.2).
 *   2. Tier / forbidden — actions run through the tier system; forbidden actions
 *                     halt, Tier-3 (and un-opted Tier-2) actions become a human
 *                     checkpoint, the run parks (§16.3).
 *   3. Corpus scope — requester-side agents are hard-pinned to the public corpus;
 *                     an attempt to widen scope is a hard failure (§16.3).
 *   4. Budget       — before each step; on exhaustion the run hands off
 *                     gracefully with a "here's where I got to" note (§16.2).
 *
 * Every executed step appends one append-only `agent_action` event with a
 * plan-state snapshot, so a run is replayable and "why did it do that" is always
 * answerable (§16.2). The orchestrator itself never mutates prior events — the
 * only way to touch the audit log is the forbidden `modify_audit_log` action.
 *
 * The harness is pure of ambient state: the clock, the capability registry, the
 * event sink, and persistence are all injected, so runs are deterministic and
 * testable without a database. Resumability falls out of this: state lives in the
 * passed-in run object (persisted after every step); calling runAgent again
 * continues from the cursor.
 */
import type {
  AgentBudgetLimits,
  AgentBudgetSpend,
  AgentPlanState,
  AgentPlanStep,
} from "@/db/schema";
import {
  isActionType,
  resolveDisposition,
  type ActionType,
  type AgencyActionPolicy,
  type Disposition,
} from "./actionTiers";
import { checkBudget, handoffMessage, recordSpend } from "./budget";
import type { AgentDefinition } from "./definitions";
import type { Capability, CapabilityContext, CapabilityRegistry } from "./tools";

/** The mutable run state the harness reads and advances (mirrors the DB row). */
export interface AgentRunState {
  id: string;
  agencyId: string;
  requestId?: string;
  status:
    | "planning"
    | "running"
    | "paused"
    | "awaiting_checkpoint"
    | "completed"
    | "exhausted"
    | "failed"
    | "cancelled";
  plan: AgentPlanState;
  budgetLimits: AgentBudgetLimits;
  budgetSpend: AgentBudgetSpend;
  handoffNote?: string | null;
  lastStepAt?: Date | null;
}

/** An append-only audit event the harness emits per step. */
export interface AgentActionEvent {
  agencyId: string;
  requestId?: string;
  agentRunId: string;
  kind: "agent_action";
  summary: string;
  payload: {
    stepIndex: number;
    capability: string;
    disposition: Disposition | "read";
    tier?: number | null;
    /** True only for autonomously-executed side-effecting actions (§16.3 attribution). */
    autonomousSend: boolean;
    /** Set when a named human approved this step at a checkpoint. */
    approvedByUserId?: string;
    note?: string;
    planSnapshot: { cursor: number; statuses: AgentPlanStep["status"][] };
  };
}

export interface RunAgentDeps {
  definition: AgentDefinition;
  policy: AgencyActionPolicy;
  registry: CapabilityRegistry;
  /** Append one event to the audit log. Must never update/delete (append-only). */
  emit: (event: AgentActionEvent) => Promise<void> | void;
  /** Persist run state after each step (resumability). Defaults to no-op. */
  persist?: (run: AgentRunState) => Promise<void> | void;
  /** Injected clock; defaults to Date.now. */
  now?: () => number;
  /** Cooperative interruption: return true to pause before the next step (§16.2). */
  shouldInterrupt?: () => boolean;
}

export type RunOutcome =
  | "completed"
  | "awaiting_checkpoint"
  | "exhausted"
  | "failed"
  | "paused"
  | "cancelled";

export interface RunResult {
  outcome: RunOutcome;
  run: AgentRunState;
  /** The step the run stopped on, if it did not complete. */
  stoppedAt?: number;
  reason?: string;
}

class StepHalt extends Error {
  constructor(
    readonly outcome: Extract<RunOutcome, "failed" | "awaiting_checkpoint">,
    readonly reason: string,
  ) {
    super(reason);
  }
}

/**
 * Run (or resume) an agent to its next stopping point: completion, a human
 * checkpoint, budget exhaustion, a cooperative pause, or a hard failure.
 */
export async function runAgent(
  run: AgentRunState,
  deps: RunAgentDeps,
): Promise<RunResult> {
  const { definition, policy, registry, emit } = deps;
  const now = deps.now ?? Date.now;
  const persist = deps.persist ?? (() => {});

  if (run.status === "cancelled") return { outcome: "cancelled", run };
  if (run.status === "paused") return { outcome: "paused", run, reason: "run is paused" };
  if (run.status === "completed") return { outcome: "completed", run };

  run.status = "running";
  const { steps } = run.plan;

  while (run.plan.cursor < steps.length) {
    if (deps.shouldInterrupt?.()) {
      run.status = "paused";
      await persist(run);
      return { outcome: "paused", run, stoppedAt: run.plan.cursor, reason: "interrupted" };
    }

    // (4) Budget — checked before the step so we never overrun.
    const budget = checkBudget(run.budgetLimits, run.budgetSpend);
    if (!budget.ok) {
      run.status = "exhausted";
      run.handoffNote = handoffMessage(budget.exhausted!, run.plan.cursor, steps.length);
      await emit(
        auditEvent(run, definition, run.plan.cursor, "budget-exhausted", "read", {
          note: run.handoffNote,
        }),
      );
      await persist(run);
      return { outcome: "exhausted", run, stoppedAt: run.plan.cursor, reason: run.handoffNote };
    }

    const step = steps[run.plan.cursor]!;
    const stepStart = now();

    try {
      const result = await executeStep(step, { run, definition, policy, registry, now });
      run.budgetSpend = recordSpend(run.budgetSpend, {
        toolCalls: 1,
        tokens: result.tokens ?? 0,
        wallClockMs: run.budgetSpend.wallClockMs + (now() - stepStart),
      });
      run.lastStepAt = new Date(now());
      await emit(
        auditEvent(run, definition, step.index, describeStep(step), result.eventDisposition, {
          tier: result.tier,
          autonomousSend: result.autonomousSend,
          approvedByUserId: step.approvedByUserId,
        }),
      );
      run.plan.cursor += 1;
      await persist(run);
    } catch (err) {
      if (err instanceof StepHalt) {
        run.status = err.outcome === "failed" ? "failed" : "awaiting_checkpoint";
        await emit(
          auditEvent(run, definition, step.index, describeStep(step), step.disposition ?? "read", {
            note: err.reason,
          }),
        );
        await persist(run);
        return { outcome: err.outcome, run, stoppedAt: step.index, reason: err.reason };
      }
      // Unexpected error from a capability implementation.
      run.status = "failed";
      step.status = "blocked";
      step.note = `capability error: ${(err as Error).message}`;
      await emit(
        auditEvent(run, definition, step.index, describeStep(step), "read", { note: step.note }),
      );
      await persist(run);
      return { outcome: "failed", run, stoppedAt: step.index, reason: step.note };
    }
  }

  run.status = "completed";
  await persist(run);
  return { outcome: "completed", run };
}

interface StepExecResult {
  tokens?: number;
  tier?: number | null;
  autonomousSend: boolean;
  eventDisposition: Disposition | "read";
}

interface StepExecCtx {
  run: AgentRunState;
  definition: AgentDefinition;
  policy: AgencyActionPolicy;
  registry: CapabilityRegistry;
  now: () => number;
}

async function executeStep(step: AgentPlanStep, ctx: StepExecCtx): Promise<StepExecResult> {
  const { run, definition, policy, registry } = ctx;
  const name = step.tool ?? step.action;

  if (!name) {
    step.status = "blocked";
    throw new StepHalt("failed", `Step ${step.index} names neither a tool nor an action.`);
  }

  // (1) Allowlist — off-list is misbehavior, halt the run.
  if (!definition.allowedCapabilities.has(name as never)) {
    step.status = "blocked";
    throw new StepHalt(
      "failed",
      `Capability "${name}" is not in the ${definition.type} agent's allowlist — refusing (§16.2).`,
    );
  }

  const action = isActionType(name);
  let eventDisposition: Disposition | "read" = "read";
  let tier: number | null | undefined;
  let autonomousSend = false;

  // (2) Tier / forbidden — only actions are tiered; read tools are always allowed.
  if (action) {
    const resolved = resolveDisposition(name as ActionType, policy);
    step.disposition = resolved.disposition;
    eventDisposition = resolved.disposition;
    tier = resolved.tier;

    if (resolved.disposition === "forbidden") {
      // Forbidden is forbidden — a recorded approval cannot revive it.
      step.status = "blocked";
      throw new StepHalt("failed", resolved.reason);
    }
    if (resolved.disposition === "requires_human") {
      if (!step.approvedByUserId) {
        // Park the run at a human checkpoint; the cursor stays on this step so
        // a later resume (after approval) re-enters here.
        step.status = "awaiting_human";
        throw new StepHalt("awaiting_checkpoint", resolved.reason);
      }
      // A named human approved THIS step (§16.3 "one approval releases") —
      // execute it as a human-authorized action, not an autonomous send.
      step.note = `approved by user:${step.approvedByUserId}`;
    } else {
      // autonomous side-effecting action → attributable as an agent-sent action.
      autonomousSend = true;
    }
  }

  // (3) Corpus scope — requester-side agents may never widen past the public corpus.
  const input = { ...(step.input ?? {}) };
  const isSearch = name === "corpus_search" || name === "connector_search";
  if (isSearch && definition.corpusScope === "public") {
    const requested = input.corpusScope;
    if (requested === "full" || requested === "internal") {
      step.status = "blocked";
      throw new StepHalt(
        "failed",
        `Requester-side agent attempted to search scope "${String(requested)}"; hard-pinned to the public corpus (§16.3).`,
      );
    }
    input.corpusScope = "public";
  }

  // Execute the capability implementation.
  const capability: Capability | undefined = registry.get(name as never);
  if (!capability) {
    step.status = "blocked";
    throw new StepHalt(
      "failed",
      `No implementation registered for capability "${name}" (wired by Phases 2–4).`,
    );
  }

  const capCtx: CapabilityContext = {
    agencyId: run.agencyId,
    agentRunId: run.id,
    requestId: run.requestId,
    corpusScope: definition.corpusScope,
  };
  const result = await capability.execute(input, capCtx);
  step.status = "done";
  step.output = result.output;
  return { tokens: result.tokens, tier, autonomousSend, eventDisposition };
}

function describeStep(step: AgentPlanStep): string {
  const name = step.tool ?? step.action ?? "unknown";
  return `${name}: ${step.description}`;
}

function auditEvent(
  run: AgentRunState,
  _definition: AgentDefinition,
  stepIndex: number,
  summary: string,
  disposition: Disposition | "read",
  extra: { tier?: number | null; autonomousSend?: boolean; approvedByUserId?: string; note?: string } = {},
): AgentActionEvent {
  return {
    agencyId: run.agencyId,
    requestId: run.requestId,
    agentRunId: run.id,
    kind: "agent_action",
    summary,
    payload: {
      stepIndex,
      capability: run.plan.steps[stepIndex]?.tool ?? run.plan.steps[stepIndex]?.action ?? "unknown",
      disposition,
      tier: extra.tier ?? null,
      autonomousSend: extra.autonomousSend ?? false,
      approvedByUserId: extra.approvedByUserId,
      note: extra.note,
      planSnapshot: {
        cursor: run.plan.cursor,
        statuses: run.plan.steps.map((s) => s.status),
      },
    },
  };
}
