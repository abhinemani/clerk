import { describe, expect, it } from "vitest";
import { describeRange, parseDateQuery, withinRange } from "./dateQuery";

// Fixed clock — the whole module takes `now` as an argument precisely so these
// assertions never drift.
const NOW = new Date("2026-08-13T15:00:00Z");

describe("parseDateQuery", () => {
  it("parses the flagship phrasing and strips the window from the subject", () => {
    const r = parseDateQuery("street cleanings for the last 3 months", NOW);
    expect(r.range).toEqual({ from: "2026-05-13", to: "2026-08-13" });
    // the subject survives; "for the last 3 months" does not pollute matching
    expect(r.residual).toBe("street cleanings");
  });

  it("accepts spelled-out numbers and each unit", () => {
    expect(parseDateQuery("permits past six weeks", NOW).range).toEqual({
      from: "2026-07-02",
      to: "2026-08-13",
    });
    expect(parseDateQuery("inspections last 30 days", NOW).range).toEqual({
      from: "2026-07-14",
      to: "2026-08-13",
    });
    expect(parseDateQuery("contracts last 2 years", NOW).range).toEqual({
      from: "2024-08-13",
      to: "2026-08-13",
    });
  });

  it("handles the bare singular", () => {
    expect(parseDateQuery("council minutes last month", NOW).range).toEqual({
      from: "2026-07-13",
      to: "2026-08-13",
    });
  });

  it("clamps month arithmetic instead of rolling into the next month", () => {
    // One month before 31 March is 28 Feb (2026 is not a leap year), NOT 3 March.
    const r = parseDateQuery("last 1 month", new Date("2026-03-31T00:00:00Z"));
    expect(r.range?.from).toBe("2026-02-28");
  });

  it("parses 'since <month>' and never reaches into the future", () => {
    // August has passed in 2026, so "since March" means this year.
    expect(parseDateQuery("emails since March", NOW).range).toEqual({
      from: "2026-03-01",
      to: "2026-08-13",
    });
    // November has NOT happened yet in 2026 — it means last November.
    expect(parseDateQuery("emails since November", NOW).range?.from).toBe("2025-11-01");
  });

  it("parses explicit years and year-to-date", () => {
    expect(parseDateQuery("budget in 2024", NOW).range).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
    });
    expect(parseDateQuery("spending this year", NOW).range).toEqual({
      from: "2026-01-01",
      to: "2026-08-13",
    });
  });

  it("stays silent when the query names no window", () => {
    const r = parseDateQuery("the Acme paving contract", NOW);
    expect(r.range).toBeNull();
    expect(r.residual).toBe("the Acme paving contract");
    expect(r.matchedPhrase).toBeNull();
  });

  it("keeps the original query when the window IS the whole query", () => {
    // Nothing left to search on — returning "" would match everything.
    const r = parseDateQuery("last 3 months", NOW);
    expect(r.range).not.toBeNull();
    expect(r.residual).toBe("last 3 months");
  });
});

describe("withinRange", () => {
  const range = { from: "2026-05-13", to: "2026-08-13" };

  it("includes the boundaries", () => {
    expect(withinRange("2026-05-13", range)).toBe(true);
    expect(withinRange("2026-08-13", range)).toBe(true);
  });

  it("excludes outside the window", () => {
    expect(withinRange("2026-05-12", range)).toBe(false);
    expect(withinRange("2019-06-01", range)).toBe(false);
  });

  it("tolerates full timestamps", () => {
    expect(withinRange("2026-06-01T12:00:00Z", range)).toBe(true);
  });

  it("KEEPS undated and unparseable records", () => {
    // A missing date means "unknown", not "old". Dropping these would quietly
    // shrink what the public can see.
    expect(withinRange(undefined, range)).toBe(true);
    expect(withinRange(null, range)).toBe(true);
    expect(withinRange("sometime in June", range)).toBe(true);
  });
});

describe("describeRange", () => {
  it("renders a window for UI copy", () => {
    expect(describeRange({ from: "2026-05-13", to: "2026-08-13" })).toBe(
      "May 13, 2026 – Aug 13, 2026",
    );
  });
});
