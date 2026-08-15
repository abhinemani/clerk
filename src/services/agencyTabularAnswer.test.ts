/**
 * Staff-scoped tabular lookup (fulfillment v2 connector_search). Mirrors
 * tabularAnswerService.test.ts's setup; the one behavioral delta under test
 * is that INTERNAL slices count here, where they never would on the public
 * path — everything else (ambiguous-dataset refusal, no-hits refusal) rides
 * the same shared composeTabularAnswer the public path uses.
 */
import { describe, expect, it } from "vitest";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency } from "./repository";
import { findAgencyTabularAnswer } from "./agencyTabularAnswer";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const NOW = new Date("2026-08-15T12:00:00Z");

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
        syncedAt: "2026-08-14T05:00:00.000Z",
        columns: ["date", "street"],
      },
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

const item = (dataset: string) => ({ connectedSource: { dataset, sourceName: "Riverton Open Data" } });

describe("findAgencyTabularAnswer", () => {
  it("counts rows across BOTH public and internal slices (staff scope)", async () => {
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
      rows: [{ date: "2026-07-07", street: "Mill Rd" }],
    });

    const t = await findAgencyTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping",
      items: [item("street-sweeping")],
    });
    expect(t).not.toBeNull();
    // The public service would report 1 (the internal slice hidden); the
    // staff variant sees both — this is the entire point of connector_search.
    expect(t!.totalRows).toBe(2);
    expect(t!.periods).toEqual(["2026-06", "2026-07"]);
  });

  it("refuses when hits span more than one dataset", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-1",
      dataset: "street-sweeping",
      period: "2026-06",
      classification: "internal",
      rows: [{ date: "2026-06-02", street: "Oak Ave" }],
    });
    const t = await findAgencyTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping",
      items: [item("street-sweeping"), item("pothole-repairs")],
    });
    expect(t).toBeNull();
  });

  it("returns null with no connected hits at all", async () => {
    const deps = makeDeps();
    expect(
      await findAgencyTabularAnswer(deps, {
        agencyId: "ag-1",
        query: "anything",
        items: [{ connectedSource: null }],
      }),
    ).toBeNull();
  });

  it("returns null when the dataset has no rows in the window", async () => {
    const deps = makeDeps();
    await seedSlice(deps, {
      id: "d-1",
      dataset: "street-sweeping",
      period: "2026-01",
      classification: "internal",
      rows: [{ date: "2026-01-05", street: "Winter Way" }],
    });
    const t = await findAgencyTabularAnswer(deps, {
      agencyId: "ag-1",
      query: "street sweeping last 3 months", // NOW is 2026-08-15; January falls out
      items: [item("street-sweeping")],
    });
    expect(t).toBeNull();
  });
});
