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
    baseUrl: "https://brandeis.example",
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
    expect(msg.body).toContain(`https://brandeis.example/task/${task.token}`);

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

describe("dispatchTask — responder heads-up (department-scoped accounts)", () => {
  async function setupWithResponders() {
    const ctx = await setup();
    await ctx.repo.createDepartment({ id: "dept-pw", agencyId: "ag-1", name: "Public Works", defaultResponderEmails: [] });
    await ctx.repo.createDepartment({ id: "dept-pd", agencyId: "ag-1", name: "Police Records", defaultResponderEmails: [] });
    await ctx.repo.createUser({ id: "u-sam", agencyId: "ag-1", email: "sam@riverton.gov", name: "Sam Iyer", role: "responder", passwordHash: "x" });
    await ctx.repo.createUser({ id: "u-kai", agencyId: "ag-1", email: "kai@riverton.gov", name: "Kai Ortiz", role: "responder", passwordHash: "x" });
    await ctx.repo.createUser({ id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "coordinator", passwordHash: "x" });
    await ctx.repo.setUserDepartments("ag-1", "u-sam", ["dept-pw"]);
    await ctx.repo.setUserDepartments("ag-1", "u-kai", ["dept-pd"]);
    return ctx;
  }

  it("notifies the dispatched department's responders — sign-in pointer, NO token", async () => {
    const { deps, notifier, repo, requestId } = await setupWithResponders();
    const task = await dispatchTask(deps, {
      agencyId: "ag-1",
      requestId,
      departmentId: "dept-pw",
      departmentName: "Public Works",
      departmentEmail: "mbell@riverton.gov",
      scopeText: "Inspection reports.",
    });

    const notices = notifier.sent.filter((m) => m.kind === "task_responder_notice");
    expect(notices.map((m) => m.to)).toEqual(["sam@riverton.gov"]); // Kai is Police Records — not notified
    // The credential link stays with the department inbox ONLY (handoff rule):
    // a forwarded heads-up must not carry fulfillment authority.
    expect(notices[0]!.body).not.toContain(task.token);
    expect(notices[0]!.body).toContain("https://brandeis.example/riverton/app/tasks");

    const events = await repo.listEvents("ag-1", requestId);
    const headsUp = events.find((e) => e.summary.includes("Heads-up"));
    expect(headsUp?.payload?.to).toEqual(["sam@riverton.gov"]);
  });

  it("skips coordinators, other departments, and the dept inbox itself", async () => {
    const { deps, notifier, repo } = await setupWithResponders();
    // Sam's login email IS the department inbox — no duplicate notice.
    await repo.updateUser("ag-1", "u-sam", { email: "mbell@riverton.gov" });
    const request2 = await submitRequest(deps, { agencyId: "ag-1", rawText: "more records" });
    await dispatchTask(deps, {
      agencyId: "ag-1",
      requestId: request2.id,
      departmentId: "dept-pw",
      departmentName: "Public Works",
      departmentEmail: "mbell@riverton.gov",
      scopeText: "s",
    });
    expect(notifier.sent.filter((m) => m.kind === "task_responder_notice")).toHaveLength(0);
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
