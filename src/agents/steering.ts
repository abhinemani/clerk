/**
 * Run steering (§16.2 "a human can pause/redirect any run from the UI") — the
 * approve-and-resume loop behind /app/agents.
 *
 * A run parked `awaiting_checkpoint` has its cursor ON the gated step. A named
 * staff member approves exactly that step (approval is per-step, never
 * per-run), and the run resumes through the SAME harness — allowlist, tiers,
 * budget, audit events — with the approval attributed in the step's audit
 * event. Skipping marks the step skipped and moves on; cancelling ends the
 * run. Every steering act lands in the append-only admin log.
 */
import type { AgentRunEntity } from "@/services/repository";
import type { ServiceDeps } from "@/services/deps";
import { DEFAULT_ACTION_POLICY } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { deadlineCapabilityRegistry } from "./deadlineAgent";
import { fulfillmentCapabilityRegistry } from "./fulfillmentAgent";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentRunState, type RunResult } from "./runHarness";
import type { CapabilityRegistry } from "./tools";

export class AgentSteeringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSteeringError";
  }
}

/** Registry factory per persisted agent type; resume needs real capabilities. */
function registryFor(row: AgentRunEntity, deps: ServiceDeps): CapabilityRegistry {
  switch (row.agentType) {
    case "deadline":
      return deadlineCapabilityRegistry(row.agencyId, deps);
    case "fulfillment":
      return fulfillmentCapabilityRegistry(row.agencyId, deps);
    default:
      throw new AgentSteeringError(
        `Resume is not wired for the ${row.agentType} agent yet — cancel the run instead.`,
      );
  }
}

function toRunState(row: AgentRunEntity): AgentRunState {
  if (!row.plan) throw new AgentSteeringError("This run has no persisted plan to resume.");
  return {
    id: row.id,
    agencyId: row.agencyId,
    requestId: row.requestId ?? undefined,
    status: "running",
    plan: row.plan,
    budgetLimits: row.budgetLimits ?? { ...DEFAULT_BUDGET },
    budgetSpend: row.budgetSpend ?? { ...ZERO_SPEND },
    handoffNote: row.handoffNote,
    lastStepAt: row.lastStepAt,
  };
}

async function loadParkedRun(
  deps: ServiceDeps,
  agencyId: string,
  runId: string,
): Promise<AgentRunEntity> {
  const row = await deps.repo.getAgentRun(agencyId, runId);
  if (!row) throw new AgentSteeringError("Run not found.");
  if (row.status !== "awaiting_checkpoint" && row.status !== "paused") {
    throw new AgentSteeringError(`Only a parked run can be steered (this one is ${row.status}).`);
  }
  return row;
}

async function resume(
  deps: ServiceDeps,
  row: AgentRunEntity,
  actorLabel: string,
  actionSummary: string,
): Promise<RunResult> {
  const state = toRunState(row);
  const persist = async (r: AgentRunState) => {
    await deps.repo.updateAgentRun(row.agencyId, row.id, {
      status: r.status,
      plan: r.plan,
      budgetSpend: r.budgetSpend,
      handoffNote: r.handoffNote ?? null,
      lastStepAt: r.lastStepAt ?? null,
    });
  };

  const result = await runAgent(state, {
    definition: getAgentDefinition(row.agentType),
    policy: DEFAULT_ACTION_POLICY,
    registry: registryFor(row, deps),
    // Queue-wide runs audit to the admin log; per-request steps that send
    // (e.g. remindResponder) append their own request events inside the
    // capability, so nothing is lost for the per-request trail.
    emit: async (e) => {
      await deps.repo.appendAdminEvent({
        id: deps.genId(),
        agencyId: row.agencyId,
        kind: "agent_action",
        actorLabel: "agent harness",
        summary: e.summary,
        payload: e.payload,
        createdAt: deps.now(),
      });
    },
    persist,
    now: () => deps.now().getTime(),
  });
  await persist(result.run);

  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: row.agencyId,
    kind: "agent_steered",
    actorLabel,
    summary: `${actionSummary} — run ${result.outcome}`,
    payload: { runId: row.id, agentType: row.agentType, outcome: result.outcome },
    createdAt: deps.now(),
  });
  return result;
}

/** Approve the gated step the run is parked on, then resume the run. */
export async function approveAndResume(
  deps: ServiceDeps,
  input: { agencyId: string; runId: string; stepIndex: number; approver: { userId: string; label: string } },
): Promise<RunResult> {
  const row = await loadParkedRun(deps, input.agencyId, input.runId);
  const step = row.plan?.steps[row.plan.cursor];
  if (!step || step.index !== input.stepIndex) {
    throw new AgentSteeringError("The pending step changed since you loaded the page — refresh.");
  }
  step.approvedByUserId = input.approver.userId;
  step.status = "pending";
  await deps.repo.updateAgentRun(input.agencyId, input.runId, { plan: row.plan });
  return resume(
    deps,
    row,
    input.approver.label,
    `Approved "${step.action ?? step.tool}" (step ${step.index})`,
  );
}

/** Skip the gated step (marked skipped, never executed), then resume. */
export async function skipStepAndResume(
  deps: ServiceDeps,
  input: { agencyId: string; runId: string; stepIndex: number; actor: { userId: string; label: string } },
): Promise<RunResult> {
  const row = await loadParkedRun(deps, input.agencyId, input.runId);
  const plan = row.plan;
  const step = plan?.steps[plan.cursor];
  if (!plan || !step || step.index !== input.stepIndex) {
    throw new AgentSteeringError("The pending step changed since you loaded the page — refresh.");
  }
  step.status = "skipped";
  step.note = `skipped by user:${input.actor.userId}`;
  plan.cursor += 1;
  await deps.repo.updateAgentRun(input.agencyId, input.runId, { plan });
  return resume(
    deps,
    { ...row, plan },
    input.actor.label,
    `Skipped "${step.action ?? step.tool}" (step ${step.index})`,
  );
}

/** Cancel a parked run outright. */
export async function cancelRun(
  deps: ServiceDeps,
  input: { agencyId: string; runId: string; actor: { userId: string; label: string } },
): Promise<void> {
  const row = await loadParkedRun(deps, input.agencyId, input.runId);
  await deps.repo.updateAgentRun(input.agencyId, input.runId, {
    status: "cancelled",
    pausedByUserId: input.actor.userId,
  });
  await deps.repo.appendAdminEvent({
    id: deps.genId(),
    agencyId: row.agencyId,
    kind: "agent_steered",
    actorLabel: input.actor.label,
    summary: `Cancelled the ${row.agentType} run "${row.goal}"`,
    payload: { runId: row.id, agentType: row.agentType, outcome: "cancelled" },
    createdAt: deps.now(),
  });
}
