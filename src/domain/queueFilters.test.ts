/** Queue filter combining logic (§6.3 ergonomics at volume). */
import { describe, expect, it } from "vitest";
import {
  hasActiveFilters,
  matchesQueueFilters,
  parseQueueFilters,
  queueFiltersToQuery,
  type FilterableRow,
} from "./queueFilters";

const row = (over: Partial<FilterableRow> = {}): FilterableRow => ({
  assignedCoordinatorId: "u-dana",
  status: "in_progress",
  riskBand: "on_track",
  departmentIds: ["d-pw"],
  ...over,
});

describe("parseQueueFilters", () => {
  it("accepts only known values, ignoring garbage", () => {
    expect(parseQueueFilters({ assignee: "me", status: "in_progress", risk: "overdue", dept: "d-1" })).toEqual({
      assignee: "me",
      status: "in_progress",
      risk: "overdue",
      department: "d-1",
    });
    expect(parseQueueFilters({ assignee: "bogus", risk: "bogus" })).toEqual({
      assignee: null,
      status: null,
      risk: null,
      department: null,
    });
  });
});

describe("queueFiltersToQuery", () => {
  it("round-trips through parseQueueFilters", () => {
    const f = { assignee: "me" as const, status: "in_progress" as const, risk: "overdue" as const, department: "d-1" };
    const query = queueFiltersToQuery(f);
    expect(query).toBe("?assignee=me&status=in_progress&risk=overdue&dept=d-1");
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(parseQueueFilters(params)).toEqual(f);
  });

  it("is empty with no filters", () => {
    expect(queueFiltersToQuery({ assignee: null, status: null, risk: null, department: null })).toBe("");
  });
});

describe("matchesQueueFilters", () => {
  it("combines filters with AND semantics", () => {
    const f = { assignee: "me" as const, status: "in_progress" as const, risk: null, department: null };
    expect(matchesQueueFilters(row(), f, "u-dana")).toBe(true);
    expect(matchesQueueFilters(row({ status: "in_review" }), f, "u-dana")).toBe(false);
    expect(matchesQueueFilters(row(), f, "u-casey")).toBe(false); // "me" is Casey now
  });

  it("unassigned matches only a null coordinator", () => {
    const f = { assignee: "unassigned" as const, status: null, risk: null, department: null };
    expect(matchesQueueFilters(row({ assignedCoordinatorId: null }), f, "u-dana")).toBe(true);
    expect(matchesQueueFilters(row({ assignedCoordinatorId: "u-casey" }), f, "u-dana")).toBe(false);
  });

  it("department matches if ANY task on the request is in that department", () => {
    const f = { assignee: null, status: null, risk: null, department: "d-pd" };
    expect(matchesQueueFilters(row({ departmentIds: ["d-pw", "d-pd"] }), f, "u-dana")).toBe(true);
    expect(matchesQueueFilters(row({ departmentIds: ["d-pw"] }), f, "u-dana")).toBe(false);
  });

  it("no filters matches everything", () => {
    expect(matchesQueueFilters(row(), { assignee: null, status: null, risk: null, department: null }, "u-dana")).toBe(true);
  });
});

describe("hasActiveFilters", () => {
  it("is false only when every filter is null", () => {
    expect(hasActiveFilters({ assignee: null, status: null, risk: null, department: null })).toBe(false);
    expect(hasActiveFilters({ assignee: "me", status: null, risk: null, department: null })).toBe(true);
    expect(hasActiveFilters({ assignee: null, status: null, risk: null, department: "d-1" })).toBe(true);
  });
});
