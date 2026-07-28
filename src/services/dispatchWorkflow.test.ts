/**
 * Tests for the clerk → department-head delivery workflow and the management /
 * source-of-truth view (spec §4, §5, §8, §16).
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency } from "./repository";
import type { ServiceDeps } from "./deps";
import { CollectingNotifier } from "./notifications";
import { submitRequest } from "./requestService";
import { dispatchTask, remindResponder, submitTaskRecords, startTask } from "./taskService";
import { getRequestActivity } from "./activityService";

const AGENCY: Agency = {
  id: "ag-1",
  slug: "riverton",
  name: "City of Riverton",
  stateCode: "CA",
  observedHolidays: [],
};

async function setup(withNotifier = true) {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  const notifier = new CollectingNotifier(() => new Date("2026-07-27T12:00:00Z"));
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-27T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    notifier: withNotifier ? notifier : undefined,
    agencyName: AGENCY.name,
    baseUrl: "https://clerk.example",
  };
  const request = await submitRequest(deps, { agencyId: "ag-1", rawText: "records for 400 Main St" });
  return { repo, deps, notifier, requestId: request.id };
}

describe("dispatchTask delivery", () => {
  it("emails the department head the no-login link and records a delivery event", async () => {
    const { deps, notifier, repo, requestId } = await setup();
    const task = await dispatchTask(deps, {
      agencyId: "ag-1",
      requestId,
      departmentName: "Public Works",
      departmentEmail: "mbell@riverton.gov",
      departmentLead: "Marcus Bell",
      scopeText: "Inspection reports for 400 Main St.",
    });

    // The email actually went out, to the right person, with the token link.
    expect(notifier.sent).toHaveLength(1);
    const msg = notifier.sent[0]!;
    expect(msg.to).toBe("mbell@riverton.gov");
    expect(msg.kind).toBe("task_dispatch");
    expect(msg.body).toContain(`https://clerk.example/task/${task.token}`);

    // The delivery is in the append-only source of truth.
    const events = await repo.listEvents("ag-1", requestId);
    const delivery = events.find((e) => e.kind === "delivery");
    expect(delivery?.payload?.to).toBe("mbell@riverton.gov");
  });

  it("still works with no notifier configured (mints the link, sends nothing)", async () => {
    const { deps, repo, requestId } = await setup(false);
    await dispatchTask(deps, { agencyId: "ag-1", requestId, scopeText: "s", departmentEmail: "x@y.gov" });
    const events = await repo.listEvents("ag-1", requestId);
    expect(events.some((e) => e.kind === "delivery")).toBe(false);
    expect(events.some((e) => e.kind === "assignment")).toBe(true);
  });

  it("accepts an AI-drafted notice body", async () => {
    const { deps, notifier, requestId } = await setup();
    await dispatchTask(deps, {
      agencyId: "ag-1",
      requestId,
      departmentEmail: "x@y.gov",
      scopeText: "s",
      draftedBody: { subject: "Custom subject", body: "AI-drafted body." },
    });
    expect(notifier.sent[0]!.subject).toBe("Custom subject");
  });
});

describe("remindResponder", () => {
  it("sends a reminder and logs it as a delivery", async () => {
    const { deps, notifier, repo, requestId } = await setup();
    const task = await dispatchTask(deps, { agencyId: "ag-1", requestId, scopeText: "s", departmentEmail: "x@y.gov" });
    await remindResponder(deps, {
      agencyId: "ag-1",
      taskId: task.id,
      departmentEmail: "x@y.gov",
      departmentName: "Public Works",
    });
    expect(notifier.sent.filter((m) => m.kind === "task_reminder")).toHaveLength(1);
    const events = await repo.listEvents("ag-1", requestId);
    expect(events.filter((e) => e.kind === "delivery")).toHaveLength(2); // dispatch + reminder
  });
});

describe("getRequestActivity — the management / source-of-truth view", () => {
  it("assembles the audit log + task rollup + what-needs-attention", async () => {
    const { deps, requestId } = await setup();
    // Two departments: one working, one that submitted records.
    await dispatchTask(deps, { agencyId: "ag-1", requestId, departmentName: "Public Works", scopeText: "a" });
    const t2 = await dispatchTask(deps, { agencyId: "ag-1", requestId, departmentName: "Police Records", scopeText: "b" });
    await startTask(deps, "ag-1", t2.id);
    await submitTaskRecords(deps, { agencyId: "ag-1", taskId: t2.id, uploads: [{ name: "r.pdf" }] });

    const activity = await getRequestActivity(deps, "ag-1", requestId);
    expect(activity.tasks).toHaveLength(2);
    expect(activity.taskRollup.total).toBe(2);
    expect(activity.attention.awaitingReview).toBe(1); // Police Records submitted
    expect(activity.attention.awaitingDepartments).toBe(1); // Public Works still assigned
    expect(activity.attention.readyToRelease).toBe(false);
    // Events are the chronological source of truth (submit + 2 assignments + 1 note).
    expect(activity.events.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < activity.events.length; i++) {
      expect(activity.events[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        activity.events[i - 1]!.createdAt.getTime(),
      );
    }
  });
});
