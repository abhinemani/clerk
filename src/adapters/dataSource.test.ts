/**
 * Connector conformance (docs/connected-sources.md test plan): both
 * implementations pass identical listDatasets/fetchSlice/probe assertions,
 * so a future HTTP/Socrata connector drops into the same suite.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import {
  createFileDropConnector,
  createMemoryConnector,
  parseSliceFilename,
  periodEndDate,
  type DataSourceConnector,
} from "./dataSource";

describe("periodEndDate", () => {
  it("covers year, month, and day periods — month arithmetic clamps", () => {
    expect(periodEndDate("2026")).toBe("2026-12-31");
    expect(periodEndDate("2026-06")).toBe("2026-06-30");
    expect(periodEndDate("2026-02")).toBe("2026-02-28"); // not the 30th
    expect(periodEndDate("2024-02")).toBe("2024-02-29"); // leap year
    expect(periodEndDate("2026-06-15")).toBe("2026-06-15");
  });

  it("refuses non-periods and impossible dates", () => {
    for (const bad of ["06-2026", "2026-13", "2026-02-30", "yesterday", ""]) {
      expect(periodEndDate(bad)).toBeNull();
    }
  });
});

describe("parseSliceFilename", () => {
  it("parses dataset.period.csv and normalizes the dataset name", () => {
    expect(parseSliceFilename("Street-Sweeping.2026-06.csv")).toEqual({
      dataset: "street-sweeping",
      period: "2026-06",
    });
  });
  it("ignores everything else (no accidental ingestion of stray files)", () => {
    for (const name of ["notes.txt", "data.csv", "x.2026-13.csv", "a.b.2026.csv", ".2026.csv"]) {
      expect(parseSliceFilename(name)).toBeNull();
    }
  });
});

/* Shared conformance run against each implementation. */

const SLICES = [
  { dataset: "street-sweeping", period: "2026-05", csv: "date,route\n2026-05-02,North" },
  { dataset: "street-sweeping", period: "2026-06", csv: "date,route\n2026-06-06,South" },
  { dataset: "permits", period: "2026", csv: "id,street\n41,Main St" },
];

const cleanups: (() => void)[] = [];
afterAll(() => cleanups.forEach((fn) => fn()));

function fileDropFixture(): DataSourceConnector {
  const base = mkdtempSync(path.join(tmpdir(), "brandeis-drop-"));
  const agencyDir = path.join(base, "agency-1");
  mkdirSync(agencyDir);
  for (const s of SLICES) {
    writeFileSync(path.join(agencyDir, `${s.dataset}.${s.period}.csv`), s.csv);
  }
  writeFileSync(path.join(agencyDir, "README.txt"), "not a slice");
  const prev = process.env.CONNECTED_DROP_PATH;
  process.env.CONNECTED_DROP_PATH = base;
  const connector = createFileDropConnector("agency-1");
  process.env.CONNECTED_DROP_PATH = prev;
  cleanups.push(() => rmSync(base, { recursive: true, force: true }));
  return connector;
}

const IMPLEMENTATIONS: [string, () => DataSourceConnector][] = [
  ["file_drop", fileDropFixture],
  ["memory", () => createMemoryConnector(SLICES)],
];

describe.each(IMPLEMENTATIONS)("connector conformance: %s", (_name, make) => {
  it("lists datasets with ascending periods, ignoring non-slice files", async () => {
    const c = make();
    expect(await c.listDatasets()).toEqual([
      { dataset: "permits", periods: ["2026"] },
      { dataset: "street-sweeping", periods: ["2026-05", "2026-06"] },
    ]);
  });

  it("fetches a slice with bytes and the period-end recordDate", async () => {
    const c = make();
    const slice = await c.fetchSlice("street-sweeping", "2026-06");
    expect(slice).not.toBeNull();
    expect(slice!.recordDate).toBe("2026-06-30");
    expect(slice!.csv.toString()).toContain("South");
    expect(slice!.filename).toBe("street-sweeping.2026-06.csv");
  });

  it("returns null for unknown slices instead of throwing", async () => {
    const c = make();
    expect(await c.fetchSlice("street-sweeping", "2019-01")).toBeNull();
    expect(await c.fetchSlice("nope", "2026-06")).toBeNull();
  });

  it("probe reports ok", async () => {
    expect((await make().probe()).ok).toBe(true);
  });
});

describe("file-drop specifics", () => {
  it("probe is honest about a missing drop directory", async () => {
    const prev = process.env.CONNECTED_DROP_PATH;
    process.env.CONNECTED_DROP_PATH = path.join(tmpdir(), "brandeis-none");
    const c = createFileDropConnector("never-created");
    process.env.CONNECTED_DROP_PATH = prev;
    const probe = await c.probe();
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("Drop directory");
    expect(await c.listDatasets()).toEqual([]);
  });
});
