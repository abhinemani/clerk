/** Tests for deadline-risk scoring (spec §8, §16.1). */
import { describe, expect, it } from "vitest";
import { byRiskDesc, deadlineRisk } from "./deadlineRisk";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 7, 27);

describe("bands", () => {
  it("is overdue when the due date has passed", () => {
    const r = deadlineRisk({ dueAt: utc(2026, 7, 20), now: NOW, outstandingTasks: 0, complexityScore: 0 });
    expect(r.band).toBe("overdue");
    expect(r.daysRemaining).toBe(-7);
  });

  it("is due_soon within the threshold (default 3 days)", () => {
    const r = deadlineRisk({ dueAt: utc(2026, 7, 29), now: NOW, outstandingTasks: 0, complexityScore: 0 });
    expect(r.band).toBe("due_soon");
    expect(r.daysRemaining).toBe(2);
  });

  it("is on_track beyond the threshold", () => {
    const r = deadlineRisk({ dueAt: utc(2026, 8, 15), now: NOW, outstandingTasks: 0, complexityScore: 0 });
    expect(r.band).toBe("on_track");
  });

  it("respects a custom due-soon threshold", () => {
    const r = deadlineRisk({
      dueAt: utc(2026, 8, 3),
      now: NOW,
      outstandingTasks: 0,
      complexityScore: 0,
      dueSoonThresholdDays: 7,
    });
    expect(r.band).toBe("due_soon");
  });
});

describe("score", () => {
  it("stays within [0,1]", () => {
    const r = deadlineRisk({ dueAt: utc(2026, 7, 1), now: NOW, outstandingTasks: 99, complexityScore: 5 });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it("increases with outstanding tasks", () => {
    const base = { dueAt: utc(2026, 8, 10), now: NOW, complexityScore: 0.5 };
    const few = deadlineRisk({ ...base, outstandingTasks: 0 });
    const many = deadlineRisk({ ...base, outstandingTasks: 5 });
    expect(many.score).toBeGreaterThan(few.score);
  });

  it("increases with complexity", () => {
    const base = { dueAt: utc(2026, 8, 10), now: NOW, outstandingTasks: 1 };
    const simple = deadlineRisk({ ...base, complexityScore: 0 });
    const complex = deadlineRisk({ ...base, complexityScore: 1 });
    expect(complex.score).toBeGreaterThan(simple.score);
  });

  it("ranks an overdue request above an on-track one", () => {
    const overdue = deadlineRisk({ dueAt: utc(2026, 7, 20), now: NOW, outstandingTasks: 1, complexityScore: 0.2 });
    const onTrack = deadlineRisk({ dueAt: utc(2026, 8, 20), now: NOW, outstandingTasks: 1, complexityScore: 0.2 });
    expect(overdue.score).toBeGreaterThan(onTrack.score);
    expect([overdue, onTrack].sort(byRiskDesc)[0]).toBe(overdue);
  });
});
