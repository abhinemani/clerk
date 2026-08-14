/**
 * Tabular answers (connected-sources phase 3): the composer's whole job is
 * knowing when NOT to answer — every refusal rule here is load-bearing,
 * because a wrong table is confidently wrong.
 */
import { describe, expect, it } from "vitest";
import { composeTabularAnswer, TABULAR_ANSWER_MAX_ROWS } from "./tabularAnswer";

const row = (date: string, street: string, i = 0) => ({
  data: { sweep_date: date, street, ward: String(i % 3) },
  recordDate: date,
  period: date.slice(0, 7),
});

const base = {
  dataset: "street-sweeping",
  sourceName: "Riverton Open Data",
  syncedAt: "2026-08-13T05:00:00.000Z",
  columns: ["sweep_date", "street", "ward"],
  rangeLabel: null as string | null,
  residualQuery: "street sweeping",
};

describe("composeTabularAnswer", () => {
  it("answers with the rows and a checkable basis", () => {
    const rows = [row("2026-06-02", "Oak Ave"), row("2026-06-09", "Mill Rd"), row("2026-07-07", "Oak Ave")];
    const t = composeTabularAnswer({ ...base, rows, totalRows: 3, rangeLabel: "June–July 2026" })!;
    expect(t.totalRows).toBe(3);
    expect(t.shownRows).toBe(3);
    expect(t.columns).toEqual(["sweep_date", "street", "ward"]);
    expect(t.rows[0]).toEqual(["2026-06-02", "Oak Ave", "0"]);
    expect(t.periods).toEqual(["2026-06", "2026-07"]);
    expect(t.title).toBe("Street Sweeping");
    expect(t.basis).toContain("3 rows");
    expect(t.basis).toContain("within June–July 2026");
    expect(t.basis).toContain("2 published slices");
    expect(t.basis).toContain("synced 2026-08-13");
  });

  it("refuses an empty window — no rows, no table", () => {
    expect(composeTabularAnswer({ ...base, rows: [], totalRows: 0 })).toBeNull();
  });

  it("filters rows by terms that match cell values, with an honest count", () => {
    const rows = [row("2026-06-02", "Oak Ave"), row("2026-06-09", "Mill Rd"), row("2026-07-07", "Oak Ave")];
    const t = composeTabularAnswer({
      ...base,
      rows,
      totalRows: 3,
      residualQuery: "street sweeping oak",
    })!;
    expect(t.filteredBy).toBe("oak");
    expect(t.totalRows).toBe(2);
    expect(t.rows.every((r) => r[1] === "Oak Ave")).toBe(true);
    expect(t.basis).toContain('matching "oak"');
  });

  it("refuses when the unconnected terms outweigh the ones the data accounts for", () => {
    const rows = [row("2026-06-02", "Oak Ave")];
    // Nothing in "pothole repair complaints" names or appears in the data.
    expect(
      composeTabularAnswer({ ...base, rows, totalRows: 1, residualQuery: "pothole repair complaints" }),
    ).toBeNull();
    // Majority unconnected: one naming term can't carry two strangers.
    expect(
      composeTabularAnswer({ ...base, rows, totalRows: 1, residualQuery: "sweeping pothole complaints" }),
    ).toBeNull();
  });

  it("one stray synonym does not refuse a clearly-labeled answer", () => {
    const rows = [row("2026-06-02", "Oak Ave")];
    // "cleanings" is a synonym the cells can't match — but "street" names the
    // dataset, so the whole window answers, unfiltered, under its own title.
    const t = composeTabularAnswer({ ...base, rows, totalRows: 1, residualQuery: "street cleanings" })!;
    expect(t).not.toBeNull();
    expect(t.filteredBy).toBeNull();
  });

  it("terms naming the dataset or its columns calibrate, never filter", () => {
    const rows = [row("2026-06-02", "Oak Ave"), row("2026-06-09", "Mill Rd")];
    // "ward" is a column name — the whole window answers, unfiltered.
    const t = composeTabularAnswer({ ...base, rows, totalRows: 2, residualQuery: "sweeping ward" })!;
    expect(t.filteredBy).toBeNull();
    expect(t.totalRows).toBe(2);
  });

  it("refuses to FILTER a partial page (an under-count), but still counts unfiltered from the store total", () => {
    const rows = [row("2026-06-02", "Oak Ave")];
    // Partial page: 1 fetched of 500 total.
    expect(
      composeTabularAnswer({ ...base, rows, totalRows: 500, residualQuery: "street sweeping oak" }),
    ).toBeNull();
    const unfiltered = composeTabularAnswer({ ...base, rows, totalRows: 500 })!;
    expect(unfiltered.totalRows).toBe(500);
    // …and the partial page never claims a slice count it can't see.
    expect(unfiltered.basis).not.toContain("published slice");
  });

  it("caps display and says so via shownRows < totalRows", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row("2026-06-15", `Street ${i}`, i));
    const t = composeTabularAnswer({ ...base, rows, totalRows: 60 })!;
    expect(t.shownRows).toBe(TABULAR_ANSWER_MAX_ROWS);
    expect(t.totalRows).toBe(60);
  });

  it("derives columns from rows when the stamp carried none", () => {
    const rows = [row("2026-06-02", "Oak Ave")];
    const t = composeTabularAnswer({ ...base, columns: [], rows, totalRows: 1 })!;
    expect(t.columns.sort()).toEqual(["street", "sweep_date", "ward"]);
  });
});
