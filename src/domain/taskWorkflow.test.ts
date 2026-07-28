/** Tests for the coordinator ↔ responder task workflow (spec §5, §6.3). */
import { describe, expect, it } from "vitest";
import {
  assertTaskTransition,
  canTransitionTask,
  InvalidTaskTransitionError,
  isTaskTerminal,
  rollupTasks,
  taskOwner,
  type TaskLike,
} from "./taskWorkflow";

describe("transitions", () => {
  it("follows the dispatch → work → review loop", () => {
    expect(canTransitionTask("assigned", "in_progress")).toBe(true);
    expect(canTransitionTask("in_progress", "submitted")).toBe(true);
    expect(canTransitionTask("submitted", "done")).toBe(true);
    expect(canTransitionTask("pushed_back", "assigned")).toBe(true); // re-scope & reassign
  });

  it("rejects illegal moves and terminal exits", () => {
    expect(canTransitionTask("assigned", "done")).toBe(false); // must go through review
    expect(canTransitionTask("done", "in_progress")).toBe(false);
    expect(() => assertTaskTransition("done", "assigned")).toThrow(InvalidTaskTransitionError);
    expect(assertTaskTransition("submitted", "done")).toBe("done");
  });

  it("marks done and cancelled terminal", () => {
    expect(isTaskTerminal("done")).toBe(true);
    expect(isTaskTerminal("cancelled")).toBe(true);
    expect(isTaskTerminal("assigned")).toBe(false);
  });
});

describe("ownership", () => {
  it("assigns the next move to the right party", () => {
    expect(taskOwner("assigned")).toBe("responder");
    expect(taskOwner("in_progress")).toBe("responder");
    expect(taskOwner("submitted")).toBe("coordinator");
    expect(taskOwner("pushed_back")).toBe("coordinator");
    expect(taskOwner("done")).toBe("none");
  });
});

describe("rollupTasks — the coordinator's at-a-glance view", () => {
  const d = (iso: string) => new Date(iso);

  it("counts by status and splits work by court", () => {
    const tasks: TaskLike[] = [
      { status: "assigned", dueAt: d("2026-08-01") },
      { status: "in_progress", dueAt: d("2026-07-30") },
      { status: "submitted" },
      { status: "pushed_back" },
      { status: "done" },
    ];
    const r = rollupTasks(tasks);
    expect(r.total).toBe(5);
    expect(r.awaitingResponders).toBe(2);
    expect(r.awaitingCoordinator).toBe(2);
    expect(r.needsAttention).toBe(1); // the pushback
    expect(r.nextDueAt).toEqual(d("2026-07-30")); // earliest open task due
    expect(r.allComplete).toBe(false);
  });

  it("reports allComplete only when every non-cancelled task is done", () => {
    expect(rollupTasks([{ status: "done" }, { status: "cancelled" }]).allComplete).toBe(true);
    expect(rollupTasks([{ status: "done" }, { status: "assigned" }]).allComplete).toBe(false);
    expect(rollupTasks([]).allComplete).toBe(false);
  });

  it("ignores terminal tasks when computing the next due date", () => {
    const r = rollupTasks([
      { status: "done", dueAt: d("2026-07-01") },
      { status: "assigned", dueAt: d("2026-08-15") },
    ]);
    expect(r.nextDueAt).toEqual(d("2026-08-15"));
  });
});
