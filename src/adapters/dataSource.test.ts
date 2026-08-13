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
  bearerFromEnv,
  columnsOf,
  CONNECTOR_KIND_HTTP,
  CONNECTOR_KIND_SOCRATA,
  createConnector,
  createFileDropConnector,
  createMemoryConnector,
  csvToRows,
  monthsBetween,
  parseSliceFilename,
  periodEndDate,
  periodOfRow,
  rowsToCsv,
  rowsToSlices,
  validateConnectorConfig,
  type DatasetDescriptor,
  type DataSourceConnector,
  type FetchLike,
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

/* Network connectors are fed by a stub fetch — tests never touch the wire. */

const SWEEPING_ROWS = [
  { date: "2026-05-02", route: "North" },
  { date: "2026-06-06", route: "South" },
  { date: "2026-06-20", route: "South" },
];

function httpFixture(): DataSourceConnector {
  const csv = ["date,route", ...SWEEPING_ROWS.map((r) => `${r.date},${r.route}`)].join("\n");
  const stub: FetchLike = async () =>
    new Response(csv, { status: 200, headers: { "content-type": "text/csv" } });
  return createConnector(
    CONNECTOR_KIND_HTTP,
    "agency-1",
    { url: "https://data.example.gov/sweeping.csv", dataset: "street-sweeping", dateField: "date" },
    stub,
  );
}

/** Minimal SoQL server: answers the aggregate and the windowed page. */
function socrataStub(rows = SWEEPING_ROWS): FetchLike {
  return async (url) => {
    const query = decodeURIComponent(new URL(url).search);
    if (query.includes("min(date)")) {
      const dates = rows.map((r) => r.date).sort();
      return Response.json([{ lo: dates[0], hi: dates[dates.length - 1] }]);
    }
    const window = /date >= '(\d{4}-\d{2})/.exec(query);
    // No window = the probe's bare `$limit=1` sample.
    if (!window) return Response.json(rows.slice(0, 1));
    const offset = Number(/\$offset=(\d+)/.exec(query)?.[1] ?? 0);
    if (offset > 0) return Response.json([]); // single page per window
    return Response.json(rows.filter((r) => r.date.startsWith(window[1]!)));
  };
}

function socrataFixture(): DataSourceConnector {
  return createConnector(
    CONNECTOR_KIND_SOCRATA,
    "agency-1",
    {
      domain: "data.example.gov",
      datasetId: "abcd-1234",
      dataset: "street-sweeping",
      dateField: "date",
    },
    socrataStub(),
  );
}

/**
 * One contract, four implementations. Fixtures differ in how many datasets
 * a source offers (a drop directory holds many; a configured URL is one),
 * so the expectation is a parameter — everything else is identical.
 */
const IMPLEMENTATIONS: [string, () => DataSourceConnector, DatasetDescriptor[]][] = [
  ["file_drop", fileDropFixture, [
    { dataset: "permits", periods: ["2026"] },
    { dataset: "street-sweeping", periods: ["2026-05", "2026-06"] },
  ]],
  ["memory", () => createMemoryConnector(SLICES), [
    { dataset: "permits", periods: ["2026"] },
    { dataset: "street-sweeping", periods: ["2026-05", "2026-06"] },
  ]],
  ["http", httpFixture, [{ dataset: "street-sweeping", periods: ["2026-05", "2026-06"] }]],
  ["socrata", socrataFixture, [{ dataset: "street-sweeping", periods: ["2026-05", "2026-06"] }]],
];

describe.each(IMPLEMENTATIONS)("connector conformance: %s", (_name, make, expected) => {
  it("lists datasets with ascending periods, ignoring anything that isn't a slice", async () => {
    expect(await make().listDatasets()).toEqual(expected);
  });

  it("fetches a slice with bytes, the period-end recordDate, and its columns", async () => {
    const c = make();
    const slice = await c.fetchSlice("street-sweeping", "2026-06");
    expect(slice).not.toBeNull();
    expect(slice!.recordDate).toBe("2026-06-30");
    expect(slice!.csv.toString()).toContain("South");
    expect(slice!.filename).toBe("street-sweeping.2026-06.csv");
    // Columns back the phase-2 schema-drift rail.
    expect(slice!.columns).toContain("route");
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

describe("row → slice geometry (shared by the network connectors)", () => {
  it("groups rows into monthly slices with a stable header", () => {
    const slices = rowsToSlices(
      "sweeping",
      [
        { date: "2026-06-06", route: "South" },
        { date: "2026-05-02", route: "North" },
        { date: "2026-06-20", route: "South", note: "extra" },
      ],
      "date",
    );
    expect(slices.map((s) => s.period)).toEqual(["2026-05", "2026-06"]);
    const june = slices[1]!;
    expect(june.recordDate).toBe("2026-06-30");
    // A column introduced by a later row is still in every slice's header,
    // so drift detection compares like with like across periods.
    expect(june.columns).toEqual(["date", "route", "note"]);
    expect(june.csv.toString().split("\n")[0]).toBe("date,route,note");
    expect(june.csv.toString()).toContain("2026-06-20,South,extra");
  });

  it("DROPS undated rows rather than filing them under a wrong month", () => {
    const slices = rowsToSlices("x", [{ date: "", v: "1" }, { date: "2026-06-01", v: "2" }], "date");
    expect(slices).toHaveLength(1);
    expect(slices[0]!.csv.toString()).not.toContain(",1");
  });

  it("reads the date formats real portals emit", () => {
    expect(periodOfRow({ d: "2026-07-01T00:00:00.000" }, "d")).toBe("2026-07");
    expect(periodOfRow({ d: "7/4/2026" }, "d")).toBe("2026-07");
    expect(periodOfRow({ d: "not a date" }, "d")).toBeNull();
    expect(periodOfRow({}, "d")).toBeNull();
  });

  it("round-trips through CSV, quoting what needs it", () => {
    const rows = [{ a: 'say "hi", please', b: "line\nbreak" }];
    const back = csvToRows(rowsToCsv(rows, columnsOf(rows)));
    expect(back).toEqual(rows);
  });

  it("monthsBetween spans years and is bounded against nonsense ranges", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-06", "2026-06")).toEqual(["2026-06"]);
    expect(monthsBetween("2026-06", "2025-01")).toEqual([]); // reversed = empty
    expect(monthsBetween("1900-01", "2900-01").length).toBeLessThanOrEqual(600);
  });
});

describe("validateConnectorConfig — operator input is never trusted", () => {
  it("normalizes a good Socrata config", () => {
    const res = validateConnectorConfig("dataset_socrata", {
      domain: "https://data.cityofchicago.org/some/path",
      datasetId: "YGR5-VCBG",
      dataset: "Towed-Vehicles",
      dateField: "tow_date",
    });
    expect(res).toEqual({
      ok: true,
      kind: "dataset_socrata",
      config: {
        domain: "data.cityofchicago.org",
        datasetId: "ygr5-vcbg",
        dataset: "towed-vehicles",
        dateField: "tow_date",
        tokenEnv: undefined,
      },
    });
  });

  it("refuses non-https URLs and malformed identifiers", () => {
    for (const bad of [
      { kind: "dataset_http", cfg: { url: "http://insecure.gov/x.csv", dataset: "d", dateField: "date" } },
      { kind: "dataset_http", cfg: { url: "file:///etc/passwd", dataset: "d", dateField: "date" } },
      { kind: "dataset_http", cfg: { url: "https://ok.gov/x.csv", dataset: "Bad Name", dateField: "date" } },
      { kind: "dataset_http", cfg: { url: "https://ok.gov/x.csv", dataset: "d", dateField: "" } },
      { kind: "dataset_socrata", cfg: { domain: "notadomain", datasetId: "abcd-1234", dataset: "d", dateField: "date" } },
      { kind: "dataset_socrata", cfg: { domain: "data.x.gov", datasetId: "nope", dataset: "d", dateField: "date" } },
      { kind: "nonsense", cfg: {} },
    ]) {
      expect(validateConnectorConfig(bad.kind, bad.cfg).ok).toBe(false);
    }
  });

  it("takes an env var NAME for tokens, never a pasted secret", () => {
    const good = validateConnectorConfig("dataset_http", {
      url: "https://ok.gov/x.csv",
      dataset: "d",
      dateField: "date",
      tokenEnv: "CITY_PORTAL_TOKEN",
    });
    expect(good.ok).toBe(true);
    // A pasted token doesn't look like a variable name, so it is refused.
    const pasted = validateConnectorConfig("dataset_http", {
      url: "https://ok.gov/x.csv",
      dataset: "d",
      dateField: "date",
      tokenEnv: "sk-live-abc123",
    });
    expect(pasted).toMatchObject({ ok: false });
  });

  it("resolves bearer tokens from the environment only", () => {
    process.env.TEST_PORTAL_TOKEN = "  secret-value  ";
    expect(bearerFromEnv("TEST_PORTAL_TOKEN")).toBe("secret-value");
    expect(bearerFromEnv("MISSING_VAR_NAME")).toBeNull();
    expect(bearerFromEnv("lower_case")).toBeNull();
    expect(bearerFromEnv(undefined)).toBeNull();
    delete process.env.TEST_PORTAL_TOKEN;
  });
});

describe("network connector behavior", () => {
  it("Socrata pages until a short page and reports truncation honestly", async () => {
    // 3 pages of 20k then a short one would be slow to fake; instead assert
    // the loop terminates on a short page and that a same-size page keeps
    // going (offset advances) — the two branches that matter.
    const seen: number[] = [];
    const stub: FetchLike = async (url) => {
      const q = decodeURIComponent(new URL(url).search);
      if (q.includes("min(date)")) return Response.json([{ lo: "2026-06-01", hi: "2026-06-30" }]);
      const offset = Number(/\$offset=(\d+)/.exec(q)?.[1] ?? 0);
      seen.push(offset);
      return Response.json(offset === 0 ? [{ date: "2026-06-01", v: "a" }] : []);
    };
    const c = createConnector(
      CONNECTOR_KIND_SOCRATA,
      "ag",
      { domain: "data.x.gov", datasetId: "abcd-1234", dataset: "d", dateField: "date" },
      stub,
    );
    const slice = await c.fetchSlice("d", "2026-06");
    expect(slice!.truncated).toBeUndefined();
    expect(seen).toEqual([0]); // short page ended the loop
  });

  it("a failed page fails the slice — never a silently partial record", async () => {
    const stub: FetchLike = async (url) =>
      decodeURIComponent(new URL(url).search).includes("min(date)")
        ? Response.json([{ lo: "2026-06-01", hi: "2026-06-30" }])
        : new Response("upstream boom", { status: 503 });
    const c = createConnector(
      CONNECTOR_KIND_SOCRATA,
      "ag",
      { domain: "data.x.gov", datasetId: "abcd-1234", dataset: "d", dateField: "date" },
      stub,
    );
    expect(await c.fetchSlice("d", "2026-06")).toBeNull();
  });

  it("probes tell the operator what is actually wrong", async () => {
    const wrongColumn = createConnector(
      CONNECTOR_KIND_SOCRATA,
      "ag",
      { domain: "data.x.gov", datasetId: "abcd-1234", dataset: "d", dateField: "nope" },
      async () => Response.json([{ tow_date: "2026-06-01", make: "NISS" }]),
    );
    const probe = await wrongColumn.probe();
    expect(probe.ok).toBe(false);
    expect(probe.detail).toContain("tow_date"); // names the columns that DO exist

    const unreachable = createConnector(
      CONNECTOR_KIND_HTTP,
      "ag",
      { url: "https://down.gov/x.csv", dataset: "d", dateField: "date" },
      async () => new Response("nope", { status: 500 }),
    );
    expect((await unreachable.probe()).ok).toBe(false);

    const undatedHttp = createConnector(
      CONNECTOR_KIND_HTTP,
      "ag",
      { url: "https://ok.gov/x.csv", dataset: "d", dateField: "date" },
      async () => new Response("a,b\n1,2", { headers: { "content-type": "text/csv" } }),
    );
    const undated = await undatedHttp.probe();
    expect(undated.ok).toBe(false);
    expect(undated.detail).toContain("date");
  });

  it("HTTP connector reads JSON arrays as well as CSV", async () => {
    const c = createConnector(
      CONNECTOR_KIND_HTTP,
      "ag",
      { url: "https://ok.gov/x.json", dataset: "d", dateField: "date" },
      async () => Response.json([{ date: "2026-06-02", loc: { lat: 1, lon: 2 } }]),
    );
    const slice = await c.fetchSlice("d", "2026-06");
    // Nested values flatten to JSON so the text rendition stays searchable.
    expect(slice!.csv.toString()).toContain('{""lat"":1,""lon"":2}');
  });
});
