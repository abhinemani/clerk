/**
 * The learning loop end to end (docs/learning-loop.md): closed requests →
 * nightly rebuild → playbooks → a NEW similar request gets a precedent card
 * and an earned-confidence route through the existing auto-dispatch gate.
 * Offline, deterministic, zero model calls.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency, type RequestEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { applyPlaybookRouting, consultPlaybooks, rebuildAgencyPlaybooks } from "./learningService";

const AG1 = "ag-1";
const AG2 = "ag-2";
const NOW = new Date("2026-08-13T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function makeDeps(agency: Partial<Agency> = {}): ServiceDeps {
  let n = 0;
  const repo = new InMemoryRepository()
    .seedAgency({ id: AG1, slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [], ...agency })
    .seedAgency({ id: AG2, slug: "bellmar", name: "Bellmar", stateCode: "WA", observedHolidays: [] });
  return { repo, now: () => NOW, genId: () => `id-${++n}`, genToken: () => `tok-${n}` };
}

async function seedHistory(deps: ServiceDeps) {
  const dept = await deps.repo.createDepartment({
    id: "d-pw",
    agencyId: AG1,
    name: "Public Works",
    defaultResponderEmails: ["works@riverton.gov"],
  });
  const texts = [
    "towing contracts with vendors",
    "city towing contracts 2025",
    "towing contracts invoices",
  ];
  for (let i = 0; i < texts.length; i++) {
    const id = `req-${i}`;
    await deps.repo.createRequest({
      id,
      agencyId: AG1,
      publicId: `PR-2026-0000${i}`,
      requesterId: null,
      status: "fulfilled",
      rawText: texts[i]!,
      interpretedScope: null,
      recordTypes: [],
      complexityScore: null,
      receivedAt: day(60 - i),
      statutoryDueAt: day(50 - i),
      closedAt: day(53 - i),
      createdAt: day(60 - i),
    } as RequestEntity);
    await deps.repo.createTask({
      id: `task-${i}`,
      agencyId: AG1,
      requestId: id,
      departmentId: dept.id,
      scopeText: "pull towing records",
      status: "done",
      token: `t-${i}`,
      dueAt: null,
      uploads: [],
      pushbackNotes: null,
    });
  }
}

async function fileNewRequest(deps: ServiceDeps, id: string, text: string): Promise<RequestEntity> {
  return deps.repo.createRequest({
    id,
    agencyId: AG1,
    publicId: `PR-2026-00099`,
    requesterId: null,
    status: "submitted",
    rawText: text,
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: NOW,
    statutoryDueAt: new Date(NOW.getTime() + 10 * 86_400_000),
    closedAt: null,
    createdAt: NOW,
  } as RequestEntity);
}

describe("rebuildAgencyPlaybooks", () => {
  it("distills closed history into playbooks, tenant-scoped, idempotent", async () => {
    const deps = makeDeps();
    await seedHistory(deps);

    const first = await rebuildAgencyPlaybooks(deps, AG1);
    expect(first).toEqual({ playbooks: 1, episodes: 3 });

    const playbooks = await deps.repo.listPlaybooks(AG1);
    expect(playbooks[0]!.keywords).toContain("towing");
    expect(playbooks[0]!.stats.routes[0]).toMatchObject({ department: "Public Works", share: 1 });
    expect(await deps.repo.listPlaybooks(AG2)).toHaveLength(0); // invariant 2

    // Rebuild replaces wholesale — same knowledge, no duplicates.
    await rebuildAgencyPlaybooks(deps, AG1);
    expect(await deps.repo.listPlaybooks(AG1)).toHaveLength(1);
  });
});

describe("applyPlaybookRouting", () => {
  it("records the precedent card and auto-dispatches when the agency opted in and evidence clears the bar", async () => {
    const deps = makeDeps({
      workflowSettings: { autoAssign: false, autoDispatch: true, autoDispatchConfidence: 0.5, milestoneEmails: false },
    });
    await seedHistory(deps);
    await rebuildAgencyPlaybooks(deps, AG1);
    const req = await fileNewRequest(deps, "req-new", "all towing contracts since January");

    const result = await applyPlaybookRouting(deps, { agencyId: AG1, requestId: req.id, rawText: req.rawText });

    // 3 episodes, 100% Public Works → confidence 0.6 ≥ threshold 0.5 → dispatched.
    expect(result.suggested).toBe(1);
    expect(result.dispatched).toBe(1);
    const tasks = await deps.repo.listTasks(AG1, req.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.departmentId).toBe("d-pw");

    // The precedent card event is on the record, with the earned confidence.
    const events = await deps.repo.listEvents(AG1, req.id);
    const card = events.find((e) => (e.payload as { pipeline?: string })?.pipeline === "playbook_routing")!;
    expect(card.summary).toContain("3 similar past request(s)");
    const payload = card.payload as { suggestions: { confidence: number; department: string }[] };
    expect(payload.suggestions[0]).toMatchObject({ department: "Public Works", confidence: 0.6 });
  });

  it("stays advisory when auto-dispatch is off (the default posture)", async () => {
    const deps = makeDeps(); // no workflowSettings — everything manual
    await seedHistory(deps);
    await rebuildAgencyPlaybooks(deps, AG1);
    const req = await fileNewRequest(deps, "req-new", "towing contracts for the harbor");

    const result = await applyPlaybookRouting(deps, { agencyId: AG1, requestId: req.id, rawText: req.rawText });
    expect(result.dispatched).toBe(0);
    expect(await deps.repo.listTasks(AG1, req.id)).toHaveLength(0);
    // …but the precedent card is still there for the coordinator.
    const events = await deps.repo.listEvents(AG1, req.id);
    expect(events.some((e) => (e.payload as { pipeline?: string })?.pipeline === "playbook_routing")).toBe(true);
  });

  it("does nothing loud when nothing matches", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await rebuildAgencyPlaybooks(deps, AG1);
    const req = await fileNewRequest(deps, "req-new", "zoning variance appeal records");

    const result = await applyPlaybookRouting(deps, { agencyId: AG1, requestId: req.id, rawText: req.rawText });
    expect(result).toMatchObject({ suggested: 0, dispatched: 0 });
    expect(await deps.repo.listEvents(AG1, req.id)).toHaveLength(0); // no noise event
  });

  it("consultPlaybooks surfaces timing and exemption knowledge for display", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await rebuildAgencyPlaybooks(deps, AG1);
    const match = await consultPlaybooks(deps, { agencyId: AG1, text: "towing contracts request" });
    expect(match!.playbook.stats.medianDaysToClose).toBe(7);
    expect(match!.playbook.stats.samplePublicIds.length).toBeGreaterThan(0);
  });
});
