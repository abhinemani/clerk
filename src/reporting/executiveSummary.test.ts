/** Tests for the executive report's period windows and summary (docs/executive-reporting.md). */
import { describe, expect, it } from "vitest";
import {
  computeExecutiveSummary,
  priorPeriod,
  reportPeriod,
  trailingPeriods,
  type DeflectionForExecutive,
  type ExecutiveDataset,
  type RequestForExecutive,
  type TaskForExecutive,
} from "./executiveSummary";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const at = (iso: string) => new Date(iso);

function req(over: Partial<RequestForExecutive>): RequestForExecutive {
  return {
    publicId: "PR-2026-00001",
    receivedAt: d("2026-08-03"),
    closedAt: null,
    status: "in_progress",
    statutoryDueAt: d("2026-08-17"),
    extensionDates: [],
    referredAt: null,
    exemptionsCited: [],
    ...over,
  };
}

// Defaults sit INSIDE the reference week (Aug 10–16) the tests window on.
function task(over: Partial<TaskForExecutive>): TaskForExecutive {
  return { departmentName: "Public Works", createdAt: d("2026-08-11"), status: "assigned", ...over };
}

function deflection(over: Partial<DeflectionForExecutive>): DeflectionForExecutive {
  return { kind: "download", createdAt: d("2026-08-12"), hoursAvoided: 1.5, ...over };
}

function dataset(over: Partial<ExecutiveDataset> = {}): ExecutiveDataset {
  return { requests: [], tasks: [], deflections: [], ...over };
}

describe("reportPeriod", () => {
  it("snaps a day to its UTC calendar day, half-open", () => {
    const p = reportPeriod("day", at("2026-08-14T23:10:00Z"));
    expect(p.start.toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(p.label).toBe("Aug 14, 2026");
  });

  it("snaps any weekday to the enclosing Monday-start week", () => {
    // 2026-08-14 is a Friday; the week runs Mon Aug 10 → Mon Aug 17.
    const p = reportPeriod("week", at("2026-08-14T04:00:00Z"));
    expect(p.start.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-08-17T00:00:00.000Z");
    // A Monday belongs to its own week, not the previous one.
    expect(reportPeriod("week", at("2026-08-10T00:00:00Z")).start.toISOString()).toBe(
      "2026-08-10T00:00:00.000Z",
    );
    // A Sunday belongs to the week that started the prior Monday.
    expect(reportPeriod("week", at("2026-08-16T23:59:00Z")).start.toISOString()).toBe(
      "2026-08-10T00:00:00.000Z",
    );
  });

  it("snaps to calendar months across year boundaries", () => {
    const p = reportPeriod("month", at("2026-01-15T00:00:00Z"));
    expect(p.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(p.end.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(p.label).toBe("January 2026");
    const dec = priorPeriod(p);
    expect(dec.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(dec.label).toBe("December 2025");
  });

  it("trailingPeriods returns consecutive windows oldest-first, ending with the current", () => {
    const periods = trailingPeriods("week", at("2026-08-14T00:00:00Z"), 3);
    expect(periods).toHaveLength(3);
    expect(periods[0]!.start.toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(periods[2]!.start.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    // Windows tile with no gaps.
    expect(periods[0]!.end.getTime()).toBe(periods[1]!.start.getTime());
  });
});

describe("computeExecutiveSummary — KPIs", () => {
  const ref = at("2026-08-14T12:00:00Z"); // week of Aug 10–16

  it("windows received/closed and compares against the prior period", () => {
    const s = computeExecutiveSummary(
      dataset({
        requests: [
          req({ receivedAt: d("2026-08-11") }), // in window
          req({ receivedAt: d("2026-07-28"), closedAt: d("2026-08-12"), status: "fulfilled" }), // closed in window
          req({ receivedAt: d("2026-08-04"), closedAt: d("2026-08-06"), status: "fulfilled" }), // prior week
          req({ receivedAt: d("2026-07-01"), closedAt: d("2026-07-10"), status: "fulfilled" }), // long gone
        ],
      }),
      "week",
      ref,
    );
    expect(s.kpis.current.received).toBe(1);
    expect(s.kpis.current.closed).toBe(1);
    expect(s.kpis.prior.received).toBe(1);
    expect(s.kpis.prior.closed).toBe(1);
    expect(s.period.label).toContain("Aug 10");
  });

  it("measures backlog and overdue at the window END, not at generation time", () => {
    const s = computeExecutiveSummary(
      dataset({
        requests: [
          // Open through the window's end, due before it → overdue at end.
          req({ receivedAt: d("2026-07-20"), statutoryDueAt: d("2026-08-01"), closedAt: null }),
          // Closed AFTER the window ended — still backlog as of the window end.
          req({ receivedAt: d("2026-07-20"), statutoryDueAt: d("2026-09-01"), closedAt: d("2026-08-20"), status: "fulfilled" }),
          // Received after the window — not this period's backlog.
          req({ receivedAt: d("2026-08-19"), closedAt: null }),
        ],
      }),
      "week",
      ref,
    );
    expect(s.kpis.current.backlogAtEnd).toBe(2);
    expect(s.kpis.current.overdueAtEnd).toBe(1);
  });

  it("on-time uses the effective deadline and is null when nothing closed", () => {
    const closedLate = req({
      receivedAt: d("2026-08-01"),
      statutoryDueAt: d("2026-08-10"),
      closedAt: d("2026-08-12"),
      status: "fulfilled",
    });
    const closedOnTime = req({
      receivedAt: d("2026-08-01"),
      statutoryDueAt: d("2026-08-14"),
      closedAt: d("2026-08-13"),
      status: "fulfilled",
    });
    const s = computeExecutiveSummary(dataset({ requests: [closedLate, closedOnTime] }), "week", ref);
    expect(s.kpis.current.onTimeRate).toBe(0.5);
    expect(s.deadlines.closedOnTime).toBe(1);
    expect(s.deadlines.closedLate).toBe(1);

    const empty = computeExecutiveSummary(dataset(), "week", ref);
    expect(empty.kpis.current.onTimeRate).toBeNull();
    expect(empty.kpis.current.medianDaysToClose).toBeNull();
  });

  it("counts extensions by the date they were taken, not the request's receipt", () => {
    const s = computeExecutiveSummary(
      dataset({
        requests: [
          req({ receivedAt: d("2026-07-01"), extensionDates: [d("2026-08-12")] }), // old request, extended this week
          req({ receivedAt: d("2026-08-11"), extensionDates: [d("2026-08-20")] }), // extended after the window
        ],
      }),
      "week",
      ref,
    );
    expect(s.deadlines.extensionsTaken).toBe(1);
  });
});

describe("computeExecutiveSummary — sections", () => {
  const ref = at("2026-08-14T12:00:00Z");

  it("trend covers 8 tiling weeks ending with the current one", () => {
    const s = computeExecutiveSummary(dataset(), "week", ref);
    expect(s.trend.buckets).toHaveLength(8);
    expect(s.trend.buckets[7]!.label).toBe("8/10");
  });

  it("outcomes count closures by status, referrals apart, exemptions on closed-in-period requests", () => {
    const s = computeExecutiveSummary(
      dataset({
        requests: [
          req({ closedAt: d("2026-08-12"), status: "fulfilled" }),
          req({ closedAt: d("2026-08-13"), status: "denied", exemptionsCited: ["Personnel records"] }),
          req({ status: "referred", referredAt: d("2026-08-11"), closedAt: null }),
          // Closed outside the window: its exemption must not leak in.
          req({ closedAt: d("2026-08-01"), status: "denied", exemptionsCited: ["Investigative"] }),
        ],
      }),
      "week",
      ref,
    );
    expect(s.outcomes.byStatus).toEqual([
      { status: "fulfilled", count: 1 },
      { status: "denied", count: 1 },
    ]);
    expect(s.outcomes.referred).toBe(1);
    expect(s.outcomes.exemptions).toEqual([{ label: "Personnel records", count: 1 }]);
  });

  it("department rows are the dispatched-in-window cohort followed to current state", () => {
    const s = computeExecutiveSummary(
      dataset({
        tasks: [
          task({ status: "done" }),
          task({ status: "in_progress" }),
          task({ status: "cancelled" }), // dispatched but cancelled: neither done nor outstanding
          task({ departmentName: null, status: "assigned" }),
          task({ createdAt: d("2026-07-01") }), // outside the window
          task({ createdAt: null }), // pre-field task rows: excluded, not guessed
        ],
      }),
      "week",
      ref,
    );
    expect(s.departments.rows).toEqual([
      { name: "Public Works", dispatched: 3, done: 1, outstanding: 1 },
      { name: "Unassigned", dispatched: 1, done: 0, outstanding: 1 },
    ]);
  });

  it("impact excludes archive_miss from deflections and hours (house rule)", () => {
    const s = computeExecutiveSummary(
      dataset({
        deflections: [
          deflection({ hoursAvoided: 1.5 }),
          deflection({ kind: "answered_by_link", hoursAvoided: 1.0 }),
          deflection({ kind: "archive_miss", hoursAvoided: 0 }),
          deflection({ createdAt: d("2026-07-01"), hoursAvoided: 4 }), // outside window
        ],
      }),
      "week",
      ref,
    );
    expect(s.impact.deflections).toBe(2);
    expect(s.impact.hoursAvoided).toBe(2.5);
    expect(s.impact.archiveMisses).toBe(1);
  });

  it("every section carries a basis string (the number prints its arithmetic)", () => {
    const s = computeExecutiveSummary(dataset(), "month", ref);
    for (const basis of [s.kpis.basis, s.trend.basis, s.deadlines.basis, s.outcomes.basis, s.departments.basis, s.impact.basis]) {
      expect(basis.length).toBeGreaterThan(20);
    }
  });
});
