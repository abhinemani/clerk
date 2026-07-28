/** Tests for task use cases — the coordinator ↔ responder loop (spec §5, §6.3). */
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { submitRequest } from "./requestService";
import {
  acceptTaskRecords,
  dispatchTask,
  pushBackTask,
  startTask,
  submitTaskRecords,
} from "./taskService";
import { InvalidTaskTransitionError } from "@/domain/taskWorkflow";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

async function setup() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-27T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  const request = await submitRequest(deps, { agencyId: "ag-1", rawText: "records for 400 Main St" });
  return { repo, deps, request };
}

describe("the dispatch → work → review loop", () => {
  let repo: InMemoryRepository;
  let deps: ServiceDeps;
  let requestId: string;
  beforeEach(async () => {
    const s = await setup();
    repo = s.repo;
    deps = s.deps;
    requestId = s.request.id;
  });

  it("dispatches a scoped task and logs an assignment event", async () => {
    const task = await dispatchTask(deps, {
      agencyId: "ag-1",
      requestId,
      departmentId: "pw",
      departmentName: "Public Works",
      scopeText: "Inspection reports for 400 Main St.",
    });
    expect(task.status).toBe("assigned");
    expect(task.token).toBeTruthy();
    const events = await repo.listEvents("ag-1", requestId);
    expect(events.some((e) => e.kind === "assignment")).toBe(true);
  });

  it("runs a full responder round-trip to acceptance", async () => {
    const task = await dispatchTask(deps, { agencyId: "ag-1", requestId, scopeText: "s" });
    await startTask(deps, "ag-1", task.id);
    const submitted = await submitTaskRecords(deps, {
      agencyId: "ag-1",
      taskId: task.id,
      uploads: [{ name: "a.pdf", pages: 3 }],
    });
    expect(submitted.status).toBe("submitted");
    expect(submitted.uploads).toHaveLength(1);

    const done = await acceptTaskRecords(deps, { agencyId: "ag-1", taskId: task.id, actorUserId: "u-1" });
    expect(done.status).toBe("done");

    const events = await repo.listEvents("ag-1", requestId);
    expect(events.find((e) => e.kind === "approval")?.actorUserId).toBe("u-1");
  });

  it("handles a pushback from the department", async () => {
    const task = await dispatchTask(deps, { agencyId: "ag-1", requestId, scopeText: "s" });
    const pushed = await pushBackTask(deps, {
      agencyId: "ag-1",
      taskId: task.id,
      note: "Part of an open investigation — needs legal review.",
    });
    expect(pushed.status).toBe("pushed_back");
    expect(pushed.pushbackNotes).toContain("investigation");
  });

  it("rejects an illegal task transition (can't accept before submission)", async () => {
    const task = await dispatchTask(deps, { agencyId: "ag-1", requestId, scopeText: "s" });
    await expect(
      acceptTaskRecords(deps, { agencyId: "ag-1", taskId: task.id, actorUserId: "u-1" }),
    ).rejects.toBeInstanceOf(InvalidTaskTransitionError);
  });

  it("resolves a task by its no-login token", async () => {
    const task = await dispatchTask(deps, { agencyId: "ag-1", requestId, scopeText: "s" });
    const found = await repo.getTaskByToken(task.token);
    expect(found?.id).toBe(task.id);
  });
});
