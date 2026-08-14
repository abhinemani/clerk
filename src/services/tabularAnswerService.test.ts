/**
 * Tabular answers (connected-sources phase 3) — the service gate. What's
 * load-bearing here: the ONE-dataset rule, the COMPLETE-store rule, and
 * invariant 3 (an internal slice's rows can never be counted — enforced by
 * the repository query the service rides).
 */
import { describe, expect, it } from "vitest";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency } from "./repository";
import { findTabularAnswer } from "./tabularAnswerService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const NOW = new Date("2026-08-14T12:00:00Z");

function makeDeps(): ServiceDeps {
  let n = 0;
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  return { repo, now: () => NOW, genId: () => `id-${++n}`, genToken: () => `tok-${n}` };
}

async function seedSlice(
  deps: ServiceDeps,
  input: {
    id: string;
    dataset: string;
    period: string;
    classification: "public" | "internal";
    rows: { date: string; street: string }[];
    complete?: boolean;
    rowStore?: boolean;
  },
) {
  await deps.repo.createDocument({
    id: input.id,
    agencyId: "ag-1",
    sourceId: null,
    externalSystemId: `${input.dataset}:${input.period}`,
    filename: `${input.dataset}.${input.period}.csv`,
    classification: input.classification,
    recordType: "dataset",
    processingStatus: "ready",
    metadata: {
      title: `${input.dataset} — ${input.period}`,
      recordDate: `${input.period}-28`,
      connectedSource: {
        sourceId: "src-1",
        sourceName: "Riverton Open Data",
        dataset: input.dataset,
        period: input.period,
        checksum: "c",
        syncedAt: "2026-08-13T05:00:00.000Z",
        columns: ["date", "street"],
      },
      ...(input.rowStore === false
        ? {}
        : { rowStore: { rows: input.rows.length, complete: input.complete ?? true } }),
    },
    createdAt: NOW,
  });
  await deps.repo.replaceDatasetRows(
    "ag-1",
    input.id,
    input.rows.map((r, i) => ({
      id: `${input.id}-r${i}`,
      agencyId: "ag-1",
      documentId: input.id,
      dataset: input.dataset,
      period: input.period,
      rowIndex: i,
      recordDate: r.date,
      data: { date: r.date, street: r.street },
      createdAt: NOW,
    })),
  );
}

const item = (dataset: string) => ({
  connectedSource: { dataset, sourceName: "Riverton Open Data" },
});

describe("findTabularAnswer", () => {
  it("answers from public rows of the one anchored dataset", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-jun",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "public",
      rows: [
        { date: "2026-06-02", street: "Oak Ave" },
        { date: "2026-06-09", street: "Mill Rd" },
      ],
    });
    await seedSlice(deps, {
      id: "d-jul",
      dataset: "street-sweeping",
      period: "2026-07",
      classification: "public",
      rows: [{ date: "2026-07-07", street: "Oak Ave" }],
    });

    const t = await findTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping",
      items: [item("street-sweeping"), item("street-sweeping")],
    });
    expect(t).not.toBeNull();
    expect(t!.totalRows).toBe(3);
    expect(t!.periods).toEqual(["2026-06", "2026-07"]);
    expect(t!.columns).toEqual(["date", "street"]);
    expect(t!.basis).toContain("Riverton Open Data");
  });

  it("INVARIANT 3: an internal slice's rows are never counted", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-pub",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "public",
      rows: [{ date: "2026-06-02", street: "Oak Ave" }],
    });
    await seedSlice(deps, {
      id: "d-int",
      dataset: "street-sweeping",
      period: "2026-07",
      classification: "internal",
      rows: [{ date: "2026-07-07", street: "INTERNAL-MARKER-ST" }],
    });

    const t = await findTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping",
      items: [item("street-sweeping")],
    });
    // The internal slice doesn't gate the answer (it isn't public), and its
    // rows are invisible to the count and the table alike.
    expect(t!.totalRows).toBe(1);
    expect(JSON.stringify(t)).not.toContain("INTERNAL-MARKER-ST");
  });

  it("refuses when hits span more than one dataset (no unambiguous table)", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-1",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "public",
      rows: [{ date: "2026-06-02", street: "Oak Ave" }],
    });
    const t = await findTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping",
      items: [item("street-sweeping"), item("pothole-repairs")],
    });
    expect(t).toBeNull();
  });

  it("refuses when any public slice's row store is incomplete or missing", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-ok",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "public",
      rows: [{ date: "2026-06-02", street: "Oak Ave" }],
    });
    await seedSlice(deps, {
      id: "d-trunc",
      dataset: "street-sweeping",
      period: "2026-07",
      classification: "public",
      rows: [{ date: "2026-07-07", street: "Partial St" }],
      complete: false, // connector truncation — counts would lie
    });
    expect(
      await findTabularAnswer(deps, {
        agencyId: "ag-1",
        query: "street sweeping",
        items: [item("street-sweeping")],
      }),
    ).toBeNull();

    const deps2 = makeDeps();
    await seedSlice(deps2, {
      id: "d-nostore",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "public",
      rows: [{ date: "2026-06-02", street: "Oak Ave" }],
      rowStore: false, // pre-backfill slice — store not materialized yet
    });
    expect(
      await findTabularAnswer(deps2, {
        agencyId: "ag-1",
        query: "street sweeping",
        items: [item("street-sweeping")],
      }),
    ).toBeNull();
  });

  it("applies the query's date window through the store", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-jan",
      dataset: "street-sweeping",
      period: "2026-01",
      classification: "public",
      rows: [{ date: "2026-01-05", street: "Winter Way" }],
    });
    await seedSlice(deps, {
      id: "d-jun",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "public",
      rows: [{ date: "2026-06-02", street: "Oak Ave" }],
    });
    const t = await findTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping last 3 months",
      items: [item("street-sweeping")],
      rangeLabel: "the last 3 months",
    });
    // NOW is 2026-08-14: June is inside the window, January is not.
    expect(t!.totalRows).toBe(1);
    expect(t!.rows[0]![1]).toBe("Oak Ave");
    expect(t!.basis).toContain("within the last 3 months");
  });

  it("returns null with no connected hits at all", async () => {
    const deps = makeDeps();
    expect(
      await findTabularAnswer(deps, {
        agencyId: "ag-1",
        query: "anything",
        items: [{ connectedSource: null }],
      }),
    ).toBeNull();
  });
});
