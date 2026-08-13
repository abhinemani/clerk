/**
 * The checkpoint loop end to end (§16.2/§16.3): a deadline sweep plans a
 * Tier-2 custodian nudge → parks awaiting a human → a named staff member
 * approves → the resumed run sends the real email and completes. Offline:
 * InMemoryRepository + CollectingNotifier.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/services/repository";
import type { ServiceDeps } from "@/services/deps";
import { CollectingNotifier } from "@/services/notifications";
import { runDeadlineSweep } from "./deadlineAgent";
import { AgentSteeringError, approveAndResume, cancelRun, skipStepAndResume } from "./steering";
import type { AgentRunState } from "./runHarness";

const AG1 = "ag-1";
const AG2 = "ag-2";
const NOW = new Date("2026-08-13T03:00:00Z");

function makeDeps(): ServiceDeps & { notifier: CollectingNotifier } {
  let n = 0;
  const repo = new InMemoryRepository()
    .seedAgency({ id: AG1, slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] })
    .seedAgency({ id: AG2, slug: "bellmar", name: "Bellmar", stateCode: "WA", observedHolidays: [] });
  return {
    repo,
    now: () => NOW,
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier: new CollectingNotifier(),
    baseUrl: "http://test",
  };
}

/** Seed an overdue request with an open task, run the sweep persisted, return the run row id. */
async function seedParkedSweep(deps: ServiceDeps) {
  const request = await deps.repo.createRequest({
    id: "req-1",
    agencyId: AG1,
    publicId: "PR-2026-00337",
    rawText: "sweeping logs",
    status: "in_progress",
    receivedAt: new Date("2026-07-01T00:00:00Z"),
    statutoryDueAt: new Date("2026-08-01T00:00:00Z"), // overdue at NOW
    closedAt: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
  } as never);
  const task = await deps.repo.createTask({
    id: "task-1",
    agencyId: AG1,
    requestId: request.id,
    departmentId: null,
    scopeText: "pull the sweeping logs",
    status: "assigned",
    token: "tok-task",
    dueAt: null,
    uploads: [],
    pushbackNotes: null,
  });

  const runId = "run-1";
  await deps.repo.createAgentRun({
    id: runId,
    agencyId: AG1,
    agentType: "deadline",
    requestId: null,
    status: "planning",
    goal: "Nightly deadline sweep",
    plan: null,
    budgetLimits: null,
    budgetSpend: null,
    startedByUserId: null,
    handoffNote: null,
    lastStepAt: null,
    createdAt: NOW,
  });
  const persist = async (r: AgentRunState) => {
    await deps.repo.updateAgentRun(AG1, runId, {
      status: r.status,
      plan: r.plan,
      budgetSpend: r.budgetSpend,
      handoffNote: r.handoffNote ?? null,
      lastStepAt: r.lastStepAt ?? null,
    });
  };
  const result = await runDeadlineSweep({
    now: NOW,
    agencyId: AG1,
    runId,
    deps,
    persist,
    queue: [{ publicId: request.publicId, dueAt: request.statutoryDueAt!, outstandingTasks: 1, complexityScore: 0.3 }],
    nudgeTargets: [
      { publicId: request.publicId, taskId: task.id, departmentEmail: "works@riverton.gov", departmentName: "Public Works" },
    ],
  });
  await persist(result.run);
  return { runId, result, task };
}

describe("checkpoint loop", () => {
  it("a Tier-2 nudge parks the run at a human checkpoint, nothing sent", async () => {
    const deps = makeDeps();
    const { runId, result } = await seedParkedSweep(deps);

    expect(result.outcome).toBe("awaiting_checkpoint");
    expect(deps.notifier.sent).toHaveLength(0); // parked BEFORE sending

    const row = await deps.repo.getAgentRun(AG1, runId);
    expect(row?.status).toBe("awaiting_checkpoint");
    const pending = row!.plan!.steps[row!.plan!.cursor]!;
    expect(pending.action).toBe("send_custodian_nudge_email");
    expect(pending.status).toBe("awaiting_human");
  });

  it("approve-and-resume executes the step under the approver's name and completes", async () => {
    const deps = makeDeps();
    const { runId } = await seedParkedSweep(deps);
    const row = await deps.repo.getAgentRun(AG1, runId);
    const stepIndex = row!.plan!.steps[row!.plan!.cursor]!.index;

    const res = await approveAndResume(deps, {
      agencyId: AG1,
      runId,
      stepIndex,
      approver: { userId: "u-dana", label: "Dana Okafor" },
    });

    expect(res.outcome).toBe("completed");
    // The real email went out through the notifier (task_reminder machinery).
    expect(deps.notifier.sent.some((m) => m.to === "works@riverton.gov" && m.kind === "task_reminder")).toBe(true);
    // Run row reflects completion; the approved step is attributed.
    const after = await deps.repo.getAgentRun(AG1, runId);
    expect(after?.status).toBe("completed");
    const step = after!.plan!.steps.find((s) => s.action === "send_custodian_nudge_email")!;
    expect(step.status).toBe("done");
    expect(step.approvedByUserId).toBe("u-dana");
    // The steering act is in the append-only admin log.
    const adminEvents = await deps.repo.listAdminEvents(AG1);
    expect(adminEvents.some((e) => e.kind === "agent_steered" && e.actorLabel === "Dana Okafor")).toBe(true);
  });

  it("skip resumes without sending", async () => {
    const deps = makeDeps();
    const { runId } = await seedParkedSweep(deps);
    const row = await deps.repo.getAgentRun(AG1, runId);
    const stepIndex = row!.plan!.steps[row!.plan!.cursor]!.index;

    const res = await skipStepAndResume(deps, {
      agencyId: AG1,
      runId,
      stepIndex,
      actor: { userId: "u-dana", label: "Dana Okafor" },
    });
    expect(res.outcome).toBe("completed");
    expect(deps.notifier.sent).toHaveLength(0); // skipped = never executed
    const after = await deps.repo.getAgentRun(AG1, runId);
    expect(after!.plan!.steps.some((s) => s.status === "skipped")).toBe(true);
  });

  it("cancel ends a parked run; a finished run cannot be steered", async () => {
    const deps = makeDeps();
    const { runId } = await seedParkedSweep(deps);

    await cancelRun(deps, { agencyId: AG1, runId, actor: { userId: "u-dana", label: "Dana" } });
    expect((await deps.repo.getAgentRun(AG1, runId))?.status).toBe("cancelled");

    await expect(
      approveAndResume(deps, { agencyId: AG1, runId, stepIndex: 0, approver: { userId: "u-dana", label: "Dana" } }),
    ).rejects.toBeInstanceOf(AgentSteeringError);
  });

  it("tenant isolation: steering another agency's run fails (invariant 2)", async () => {
    const deps = makeDeps();
    const { runId } = await seedParkedSweep(deps);
    await expect(
      approveAndResume(deps, {
        agencyId: AG2,
        runId,
        stepIndex: 0,
        approver: { userId: "u-x", label: "X" },
      }),
    ).rejects.toBeInstanceOf(AgentSteeringError);
  });
});
