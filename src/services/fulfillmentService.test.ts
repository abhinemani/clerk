/**
 * Fulfillment agent v1 (spec §16.1): the planner-driven run behind the
 * per-agency flag. Offline and deterministic — the planner pipeline runs on
 * FakeModelClient; the fallback path runs with no client at all.
 */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "@/ai/modelClient";
import type { FulfillmentPlanOutput } from "@/ai/pipelines/fulfillmentPlan";
import type { ServiceDeps } from "./deps";
import {
  InMemoryRepository,
  type Agency,
  type DocumentEntity,
  type RequestEntity,
} from "./repository";
import { FulfillmentError, startFulfillmentRun } from "./fulfillmentService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "Riverton",
  stateCode: "CA",
  observedHolidays: [],
  settings: { fulfillmentAgent: { enabled: true } },
} as Agency;

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-14T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

const requestOf = (over: Partial<RequestEntity>): RequestEntity => ({
  id: "req-1",
  agencyId: "ag-1",
  publicId: "PR-2026-00341",
  requesterId: null,
  status: "in_progress",
  rawText: "Inspection reports and paving records for 400 Main St, 2024 to present.",
  interpretedScope: "Inspection reports and paving records for 400 Main St, 2024–present.",
  recordTypes: ["inspection reports", "contracts"],
  complexityScore: 0.4,
  receivedAt: new Date("2026-08-01T00:00:00Z"),
  statutoryDueAt: new Date("2026-08-15T00:00:00Z"),
  closedAt: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

const docOf = (id: string, filename: string, text: string): DocumentEntity =>
  ({
    id,
    agencyId: "ag-1",
    sourceId: null,
    externalSystemId: null,
    filename,
    classification: "internal",
    recordType: "inspection report",
    processingStatus: "ready",
    metadata: null,
    extractedText: text,
    createdAt: new Date("2026-07-01T00:00:00Z"),
  }) as DocumentEntity;

const PLAN: FulfillmentPlanOutput = {
  scope_items: [
    {
      label: "Inspection reports for 400 Main St",
      search_query: "inspection report 400 Main St",
      record_type: "inspection reports",
      department: "Public Works",
      task_scope: "Search inspection records for 400 Main St from 2024 to present and hand back everything found.",
      rationale: "Public Works holds inspections.",
    },
    {
      label: "Paving records for 400 Main St",
      search_query: "paving 400 Main St",
      record_type: "contracts",
      department: null,
      task_scope: null,
      rationale: "Paving contracts slice.",
    },
  ],
  memo_note: null,
};

async function seed(deps: ServiceDeps) {
  const { repo } = deps;
  await repo.createRequest(requestOf({}));
  await repo.createDepartment({
    id: "dept-pw",
    agencyId: "ag-1",
    name: "Public Works",
    defaultResponderEmails: ["works@riverton.gov"],
  });
  await repo.createDocument(
    docOf("doc-1", "inspection-400-main-2024.pdf", "Inspection report for 400 Main St paving, 2024."),
  );
  await repo.createDocument(
    docOf("doc-2", "unrelated-permit.pdf", "Fence permit for 12 Oak Ave."),
  );
}

describe("startFulfillmentRun", () => {
  it("refuses when the agency flag is off", async () => {
    const { repo, deps } = ctx();
    await repo.updateAgency("ag-1", { settings: {} });
    await seed(deps);
    await expect(
      startFulfillmentRun(deps, { agencyId: "ag-1", requestId: "req-1", actorUserId: "u-1" }),
    ).rejects.toThrow(FulfillmentError);
  });

  it("plans via the pipeline, attaches candidates, and PARKS at the Tier-2 dispatch", async () => {
    const { repo, deps } = ctx();
    await seed(deps);

    const result = await startFulfillmentRun(deps, {
      agencyId: "ag-1",
      requestId: "req-1",
      actorUserId: "u-staff",
      modelClient: new FakeModelClient([PLAN]),
    });

    expect(result.usedFallbackPlan).toBe(false);
    expect(result.itemCount).toBe(2);
    expect(result.parked).toBe(true);
    expect(result.outcome).toBe("awaiting_checkpoint");

    // The candidate record was really attached to the review set (Tier 1).
    const attached = await repo.listRequestDocuments("ag-1", "req-1");
    expect(attached.map((d) => d.id)).toContain("doc-1");

    // The run persisted, parked ON the dispatch_task step, resumable later.
    const run = (await repo.listAgentRuns("ag-1"))[0]!;
    expect(run.agentType).toBe("fulfillment");
    expect(run.status).toBe("awaiting_checkpoint");
    expect(run.startedByUserId).toBe("u-staff");
    const pending = run.plan!.steps[run.plan!.cursor]!;
    expect(pending.action).toBe("dispatch_task");
    expect(pending.input!.departmentEmail).toBe("works@riverton.gov");
    // Everything a resume needs rides in the step input (resumability rule).
    expect(pending.input!.requestId).toBe("req-1");
    expect(pending.input!.scopeText).toBeTruthy();

    // No task was dispatched — the Tier-2 send waits for a named approval.
    expect(await repo.listTasks("ag-1", "req-1")).toHaveLength(0);

    // The audit trail carries the AI plan (invariant 10) and each agent step.
    const events = await repo.listEvents("ag-1", "req-1");
    expect(events.some((e) => e.kind === "ai_action" && (e.payload as { pipeline?: string }).pipeline === "fulfillment_plan")).toBe(true);
    expect(events.filter((e) => e.kind === "agent_action").length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "note" && e.summary.includes("attached 1 candidate"))).toBe(true);
  });

  it("degrades to the deterministic fallback plan with no model client and completes (no tasks planned)", async () => {
    const { repo, deps } = ctx();
    await seed(deps);

    const result = await startFulfillmentRun(deps, {
      agencyId: "ag-1",
      requestId: "req-1",
      actorUserId: "u-staff",
      // no modelClient and no ANTHROPIC_API_KEY in tests → fallback plan
    });

    expect(result.usedFallbackPlan).toBe(true);
    expect(result.taskStepCount).toBe(0);
    expect(result.parked).toBe(false);
    expect(result.outcome).toBe("completed");

    // The memo landed on the request as a note, flagged as fallback-planned.
    const events = await repo.listEvents("ag-1", "req-1");
    const memo = events.find((e) => e.summary === "Fulfillment agent status memo");
    expect(memo).toBeTruthy();
    expect((memo!.payload as { memo: string }).memo).toContain("deterministic fallback");
  });

  it("a planner failure degrades to the fallback instead of failing the run", async () => {
    const { deps } = ctx();
    await seed(deps);
    const failing = new FakeModelClient([new Error("model down"), new Error("model down"), new Error("model down")]);
    const result = await startFulfillmentRun(deps, {
      agencyId: "ag-1",
      requestId: "req-1",
      actorUserId: "u-staff",
      modelClient: failing,
    });
    expect(result.usedFallbackPlan).toBe(true);
    expect(result.outcome).toBe("completed");
  });

  it("planner departments not in the agency list are stripped, not dispatched", async () => {
    const { repo, deps } = ctx();
    await seed(deps);
    const inventedDept: FulfillmentPlanOutput = {
      scope_items: [
        {
          ...PLAN.scope_items[0]!,
          department: "Facilities Management", // not a real department
        },
      ],
      memo_note: null,
    };
    const result = await startFulfillmentRun(deps, {
      agencyId: "ag-1",
      requestId: "req-1",
      actorUserId: "u-staff",
      modelClient: new FakeModelClient([inventedDept]),
    });
    expect(result.taskStepCount).toBe(0);
    expect(result.parked).toBe(false);
    const run = (await repo.listAgentRuns("ag-1"))[0]!;
    expect(run.plan!.steps.some((s) => s.action === "dispatch_task")).toBe(false);
  });

  it("refuses a closed request", async () => {
    const { repo, deps } = ctx();
    await seed(deps);
    await repo.updateRequest("ag-1", "req-1", { closedAt: new Date() });
    await expect(
      startFulfillmentRun(deps, { agencyId: "ag-1", requestId: "req-1", actorUserId: "u-1" }),
    ).rejects.toThrow(/closed/);
  });
});
