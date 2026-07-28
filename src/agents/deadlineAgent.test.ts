/** Tests for the deadline agent actually running through the harness (§16.1). */
import { describe, expect, it } from "vitest";
import { runDeadlineSweep, type QueueItem } from "./deadlineAgent";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 7, 27);

const QUEUE: QueueItem[] = [
  { publicId: "PR-2026-00337", dueAt: utc(2026, 7, 20), outstandingTasks: 1, complexityScore: 0.3 }, // overdue
  { publicId: "PR-2026-00341", dueAt: utc(2026, 7, 28), outstandingTasks: 2, complexityScore: 0.6 }, // due soon
  { publicId: "PR-2026-00352", dueAt: utc(2026, 8, 20), outstandingTasks: 0, complexityScore: 0.8 }, // on track
];

describe("runDeadlineSweep", () => {
  it("runs to completion through the harness and produces a morning digest", async () => {
    const res = await runDeadlineSweep({ queue: QUEUE, now: NOW });
    expect(res.outcome).toBe("completed");
    expect(res.digest).toContain("Morning digest");
    expect(res.digest).toContain("1 overdue");
    // Both at-risk requests flagged (ordered by risk score); the on-track one is not.
    expect(res.atRisk.map((a) => a.publicId).sort()).toEqual(["PR-2026-00341", "PR-2026-00337"].sort());
    expect(res.atRisk.map((a) => a.publicId)).not.toContain("PR-2026-00352");
  });

  it("pre-drafts an extension for overdue and nudges for due-soon (real agent steps)", async () => {
    const res = await runDeadlineSweep({ queue: QUEUE, now: NOW });
    const caps = res.events.map((e) => e.payload.capability);
    expect(caps).toContain("read_queue");
    expect(caps).toContain("compute_deadline_risk");
    expect(caps).toContain("create_extension_draft"); // overdue → extension
    expect(caps).toContain("internal_nudge"); // due soon → nudge
    expect(caps).toContain("status_memo");
    // Every step is attributed as an autonomous agent action in the audit log.
    expect(res.events.every((e) => e.kind === "agent_action")).toBe(true);
  });

  it("handles an all-clear queue", async () => {
    const res = await runDeadlineSweep({
      queue: [{ publicId: "PR-1", dueAt: utc(2026, 9, 1), outstandingTasks: 0, complexityScore: 0.1 }],
      now: NOW,
    });
    expect(res.atRisk).toEqual([]);
    expect(res.digest).toContain("Nothing at risk");
    expect(res.outcome).toBe("completed");
  });
});
