/**
 * Workflow-automation service tests: opt-in auto-assignment at intake and
 * confidence-gated auto-dispatch of routing suggestions. Both default OFF and
 * write the same audit events a human's actions would.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { assignCoordinator, submitRequest } from "./requestService";
import { autoDispatchSuggestions } from "./taskService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
  workflowSettings: null,
};

const user = (id: string, role: UserEntity["role"]): UserEntity => ({
  id,
  agencyId: "ag-1",
  email: `${id}@riverton.gov`,
  name: id,
  role,
  passwordHash: null,
});

function ctx(workflowSettings: Agency["workflowSettings"] = null) {
  const repo = new InMemoryRepository().seedAgency({ ...AGENCY, workflowSettings });
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-30T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

describe("auto-assignment at intake", () => {
  it("does nothing when the agency has not opted in", async () => {
    const { repo, deps } = ctx(null);
    await repo.createUser(user("u-dana", "admin"));
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "Budget records." });
    expect(r.assignedCoordinatorId ?? null).toBeNull();
  });

  it("load-balances new requests across assignable staff and logs the assignment", async () => {
    const { repo, deps } = ctx({ autoAssign: true });
    await repo.createUser(user("u-a", "admin"));
    await repo.createUser(user("u-b", "coordinator"));
    await repo.createUser(user("u-x", "responder")); // never assignable

    const r1 = await submitRequest(deps, { agencyId: "ag-1", rawText: "First." });
    const r2 = await submitRequest(deps, { agencyId: "ag-1", rawText: "Second." });
    const r3 = await submitRequest(deps, { agencyId: "ag-1", rawText: "Third." });

    // u-a and u-b alternate (least-loaded, id tiebreak); responder never picked.
    expect(r1.assignedCoordinatorId).toBe("u-a");
    expect(r2.assignedCoordinatorId).toBe("u-b");
    expect(r3.assignedCoordinatorId).toBe("u-a");

    const events = await repo.listEvents("ag-1", r1.id);
    const assignment = events.find((e) => e.kind === "assignment");
    expect(assignment?.summary).toContain("Auto-assigned to u-a");
    expect(assignment?.payload?.auto).toBe(true);
    expect(assignment?.actorUserId).toBeNull();
  });

  it("closed requests do not count toward load", async () => {
    const { repo, deps } = ctx({ autoAssign: true });
    await repo.createUser(user("u-a", "admin"));
    await repo.createUser(user("u-b", "coordinator"));
    const r1 = await submitRequest(deps, { agencyId: "ag-1", rawText: "One." });
    await repo.updateRequest("ag-1", r1.id, { closedAt: deps.now() });
    const r2 = await submitRequest(deps, { agencyId: "ag-1", rawText: "Two." });
    expect(r2.assignedCoordinatorId).toBe("u-a"); // r1 closed → u-a is free again
  });
});

describe("assignCoordinator (manual override)", () => {
  it("reassigns with a named actor and rejects non-assignable roles", async () => {
    const { repo, deps } = ctx(null);
    await repo.createUser(user("u-a", "admin"));
    await repo.createUser(user("u-x", "responder"));
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "Records." });

    const updated = await assignCoordinator(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      coordinatorUserId: "u-a",
      actorUserId: "u-a",
    });
    expect(updated.assignedCoordinatorId).toBe("u-a");
    const events = await repo.listEvents("ag-1", r.id);
    const assignment = events.find((e) => e.kind === "assignment");
    expect(assignment?.actorUserId).toBe("u-a");
    expect(assignment?.payload?.auto).toBe(false);

    await expect(
      assignCoordinator(deps, {
        agencyId: "ag-1",
        requestId: r.id,
        coordinatorUserId: "u-x",
        actorUserId: "u-a",
      }),
    ).rejects.toThrow(/cannot own requests/);

    // Unassign is allowed.
    const cleared = await assignCoordinator(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      coordinatorUserId: null,
      actorUserId: "u-a",
    });
    expect(cleared.assignedCoordinatorId).toBeNull();
  });
});

describe("autoDispatchSuggestions", () => {
  const SUGGESTIONS = [
    { departmentId: "d-pw", department: "Public Works", scope: "Inspection reports.", confidence: 0.92 },
    { departmentId: "d-pd", department: "Police Records", scope: "Incident reports.", confidence: 0.55 },
  ];

  async function seed(workflowSettings: Agency["workflowSettings"]) {
    const { repo, deps } = ctx(workflowSettings);
    repo.seedDepartment({ id: "d-pw", agencyId: "ag-1", name: "Public Works", defaultResponderEmails: ["pw@riverton.gov"] });
    repo.seedDepartment({ id: "d-pd", agencyId: "ag-1", name: "Police Records", defaultResponderEmails: ["pd@riverton.gov"] });
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "Reports please." });
    return { repo, deps, r };
  }

  it("is a no-op when the agency has not opted in", async () => {
    const { deps, r } = await seed(null);
    const out = await autoDispatchSuggestions(deps, { agencyId: "ag-1", requestId: r.id, suggestions: SUGGESTIONS });
    expect(out).toMatchObject({ dispatched: 0, reason: "disabled" });
    expect(await deps.repo.listTasks("ag-1", r.id)).toHaveLength(0);
  });

  it("dispatches only above-threshold suggestions, advances the request, and logs a digest", async () => {
    const { repo, deps, r } = await seed({ autoDispatch: true, autoDispatchConfidence: 0.8 });
    const out = await autoDispatchSuggestions(deps, { agencyId: "ag-1", requestId: r.id, suggestions: SUGGESTIONS });
    expect(out).toEqual({ dispatched: 1, heldForReview: 1 });

    const tasks = await repo.listTasks("ag-1", r.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.departmentId).toBe("d-pw");
    expect(tasks[0]!.status).toBe("assigned");

    const request = await repo.getRequest("ag-1", r.id);
    expect(request?.status).toBe("in_progress");

    const events = await repo.listEvents("ag-1", r.id);
    const digest = events.find((e) => e.payload?.pipeline === "auto_dispatch");
    expect(digest?.summary).toContain("Auto-dispatched 1 task(s) to Public Works");
    expect(digest?.summary).toContain("1 suggestion(s) held for review");
    expect(digest?.actorUserId).toBeNull();
    // The dispatch itself wrote the same assignment event a human's would.
    expect(events.some((e) => e.kind === "assignment" && e.summary.includes("Public Works"))).toBe(true);
  });

  it("never second-guesses a queue a human already started: existing tasks block it", async () => {
    const { repo, deps, r } = await seed({ autoDispatch: true });
    await repo.createTask({
      id: "t-1", agencyId: "ag-1", requestId: r.id, departmentId: "d-pd",
      scopeText: "Manual task.", status: "assigned", token: "tok-m", dueAt: null, uploads: [], pushbackNotes: null,
    });
    const out = await autoDispatchSuggestions(deps, { agencyId: "ag-1", requestId: r.id, suggestions: SUGGESTIONS });
    expect(out).toMatchObject({ dispatched: 0, reason: "tasks already exist" });
  });

  it("stands down entirely when nothing clears the threshold", async () => {
    const { repo, deps, r } = await seed({ autoDispatch: true, autoDispatchConfidence: 0.95 });
    const out = await autoDispatchSuggestions(deps, { agencyId: "ag-1", requestId: r.id, suggestions: SUGGESTIONS });
    expect(out).toMatchObject({ dispatched: 0, heldForReview: 2, reason: "below threshold" });
    expect((await deps.repo.getRequest("ag-1", r.id))?.status).toBe("submitted");
    expect(await repo.listTasks("ag-1", r.id)).toHaveLength(0);
  });

  it("does not touch requests past in_review", async () => {
    const { repo, deps, r } = await seed({ autoDispatch: true });
    await repo.updateRequest("ag-1", r.id, { status: "in_progress" });
    const out = await autoDispatchSuggestions(deps, { agencyId: "ag-1", requestId: r.id, suggestions: SUGGESTIONS });
    expect(out).toMatchObject({ dispatched: 0, reason: "request is in_progress" });
  });
});
