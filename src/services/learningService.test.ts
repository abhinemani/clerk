/**
 * The learning loop end to end (docs/learning-loop.md): closed requests →
 * nightly rebuild → plays → a NEW similar request gets a precedent card
 * and an earned-confidence route through the existing auto-dispatch gate.
 * Offline, deterministic, zero model calls.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency, type RequestEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { applyPlayRouting, consultPlays, rebuildAgencyPlays } from "./learningService";

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

describe("rebuildAgencyPlays", () => {
  it("distills closed history into plays, tenant-scoped, idempotent", async () => {
    const deps = makeDeps();
    await seedHistory(deps);

    const first = await rebuildAgencyPlays(deps, AG1);
    expect(first).toEqual({ plays: 1, episodes: 3 });

    const plays = await deps.repo.listPlays(AG1);
    expect(plays[0]!.keywords).toContain("towing");
    expect(plays[0]!.stats.routes[0]).toMatchObject({ department: "Public Works", share: 1 });
    expect(await deps.repo.listPlays(AG2)).toHaveLength(0); // invariant 2

    // Rebuild replaces wholesale — same knowledge, no duplicates.
    await rebuildAgencyPlays(deps, AG1);
    expect(await deps.repo.listPlays(AG1)).toHaveLength(1);
  });
});

describe("applyPlayRouting", () => {
  it("records the precedent card and auto-dispatches when the agency opted in and evidence clears the bar", async () => {
    const deps = makeDeps({
      workflowSettings: { autoAssign: false, autoDispatch: true, autoDispatchConfidence: 0.5, milestoneEmails: false },
    });
    await seedHistory(deps);
    await rebuildAgencyPlays(deps, AG1);
    const req = await fileNewRequest(deps, "req-new", "all towing contracts since January");

    const result = await applyPlayRouting(deps, { agencyId: AG1, requestId: req.id, rawText: req.rawText });

    // 3 episodes, 100% Public Works → confidence 0.6 ≥ threshold 0.5 → dispatched.
    expect(result.suggested).toBe(1);
    expect(result.dispatched).toBe(1);
    const tasks = await deps.repo.listTasks(AG1, req.id);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.departmentId).toBe("d-pw");

    // The precedent card event is on the record, with the earned confidence.
    const events = await deps.repo.listEvents(AG1, req.id);
    const card = events.find((e) => (e.payload as { pipeline?: string })?.pipeline === "play_routing")!;
    expect(card.summary).toContain("3 similar past request(s)");
    const payload = card.payload as { suggestions: { confidence: number; department: string }[] };
    expect(payload.suggestions[0]).toMatchObject({ department: "Public Works", confidence: 0.6 });
  });

  it("stays advisory when auto-dispatch is off (the default posture)", async () => {
    const deps = makeDeps(); // no workflowSettings — everything manual
    await seedHistory(deps);
    await rebuildAgencyPlays(deps, AG1);
    const req = await fileNewRequest(deps, "req-new", "towing contracts for the harbor");

    const result = await applyPlayRouting(deps, { agencyId: AG1, requestId: req.id, rawText: req.rawText });
    expect(result.dispatched).toBe(0);
    expect(await deps.repo.listTasks(AG1, req.id)).toHaveLength(0);
    // …but the precedent card is still there for the coordinator.
    const events = await deps.repo.listEvents(AG1, req.id);
    expect(events.some((e) => (e.payload as { pipeline?: string })?.pipeline === "play_routing")).toBe(true);
  });

  it("does nothing loud when nothing matches", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await rebuildAgencyPlays(deps, AG1);
    const req = await fileNewRequest(deps, "req-new", "zoning variance appeal records");

    const result = await applyPlayRouting(deps, { agencyId: AG1, requestId: req.id, rawText: req.rawText });
    expect(result).toMatchObject({ suggested: 0, dispatched: 0 });
    expect(await deps.repo.listEvents(AG1, req.id)).toHaveLength(0); // no noise event
  });

  it("consultPlays surfaces timing and exemption knowledge for display", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await rebuildAgencyPlays(deps, AG1);
    const match = await consultPlays(deps, { agencyId: AG1, text: "towing contracts request" });
    expect(match!.play.stats.medianDaysToClose).toBe(7);
    expect(match!.play.stats.samplePublicIds.length).toBeGreaterThan(0);
    expect(match!.matchedBy).toBe("terms");
  });
});

describe("embedding play matching (v2)", () => {
  // A crude 3-dim "meaning space" — enough to prove the plumbing: the rebuild
  // averages stored member vectors into a centroid and consultPlays falls back
  // to it for paraphrases the keyword overlap misses.
  const TOWING_DIRECTION = [0.9, 0.1, 0];

  async function seedVectors(deps: ServiceDeps) {
    for (let i = 0; i < 3; i++) {
      await deps.repo.setRequestEmbedding(AG1, `req-${i}`, TOWING_DIRECTION);
    }
  }

  it("rebuild stores a unit-length centroid of the members' ask vectors", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await seedVectors(deps);
    await rebuildAgencyPlays(deps, AG1);

    const play = (await deps.repo.listPlays(AG1))[0]!;
    expect(play.embedding).not.toBeNull();
    expect(Math.hypot(...play.embedding!)).toBeCloseTo(1, 6);
  });

  it("rebuild leaves the centroid null when no member has a vector — lexical-only, as v1", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await rebuildAgencyPlays(deps, AG1);
    expect((await deps.repo.listPlays(AG1))[0]!.embedding).toBeNull();
  });

  it("consultPlays falls back to the stored ask vector for a paraphrase", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await seedVectors(deps);
    await rebuildAgencyPlays(deps, AG1);

    // No shared keywords with the play ("towing", "contracts"...), but a
    // stored vector pointing the same way.
    const req = await fileNewRequest(deps, "req-para", "when do the wreckers haul cars off my block");
    await deps.repo.setRequestEmbedding(AG1, req.id, [0.88, 0.12, 0.02]);

    const match = await consultPlays(deps, { agencyId: AG1, text: req.rawText, requestId: req.id });
    expect(match).not.toBeNull();
    expect(match!.matchedBy).toBe("meaning");
    expect(match!.play.keywords).toContain("towing");

    // Without the requestId there is no stored vector to consult — lexical
    // miss stays a miss (no live embed call, by design).
    expect(await consultPlays(deps, { agencyId: AG1, text: req.rawText })).toBeNull();
  });

  it("a dissimilar stored vector does not match — the 0.6 bar holds", async () => {
    const deps = makeDeps();
    await seedHistory(deps);
    await seedVectors(deps);
    await rebuildAgencyPlays(deps, AG1);

    const req = await fileNewRequest(deps, "req-far", "library meeting room reservations policy");
    await deps.repo.setRequestEmbedding(AG1, req.id, [0.1, 0.2, 0.97]);
    expect(await consultPlays(deps, { agencyId: AG1, text: req.rawText, requestId: req.id })).toBeNull();
  });
});
