/**
 * Connected sources (docs/connected-sources.md phases 1-2). The invariant tests
 * here are load-bearing:
 *  - sync NEVER sets classification='public' — every new slice is born
 *    internal and waits for a named human (reviewed mode, invariant 9);
 *  - a re-sync NEVER flips a published slice back to internal or wipes its
 *    decision history (the upsert-clobber trap);
 *  - PII-flagged slices carry their sensitivity tally into the queue;
 *  - infected slices are refused, the rest of the batch lands.
 */
import { describe, expect, it } from "vitest";
import { BuiltinScanner } from "@/adapters/virusScan";
import type { BlobStore, StoredBlob } from "@/adapters/blobStore";
import { createMemoryConnector } from "@/adapters/dataSource";
import { readDocumentMeta } from "@/domain/documentMeta";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency, type UserEntity } from "./repository";
import {
  attestDataset,
  classifyNewSlice,
  deleteConnectedSource,
  describeSyncState,
  isConnectedSource,
  listConnectedSources,
  readSourceConfig,
  registerConnectedSource,
  revokeDatasetAttestation,
  setConnectedSourceSchedule,
  syncConnectedSource,
  type ConnectedDeps,
} from "./connectedSourceService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const ADMIN: UserEntity = { id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "admin", passwordHash: null };

class MemoryBlobStore implements BlobStore {
  blobs = new Map<string, StoredBlob>();
  async put(key: string, bytes: Buffer, contentType: string) {
    this.blobs.set(key, { bytes, contentType });
    return key;
  }
  async get(key: string) {
    return this.blobs.get(key) ?? null;
  }
}

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const blobStore = new MemoryBlobStore();
  const deps: ServiceDeps & { blobStore: MemoryBlobStore; virusScanner: BuiltinScanner } = {
    repo,
    now: () => new Date("2026-08-13T06:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    blobStore,
    virusScanner: new BuiltinScanner(),
  };
  return { repo, deps };
}

async function registered(deps: ServiceDeps) {
  await deps.repo.createUser(ADMIN);
  const { source } = await registerConnectedSource(deps, {
    agencyId: "ag-1",
    actorUserId: "u-dana",
    name: "City open data",
  });
  return source;
}

const SWEEPING = [
  { dataset: "street-sweeping", period: "2026-05", csv: "date,route\n2026-05-02,North" },
  { dataset: "street-sweeping", period: "2026-06", csv: "date,route\n2026-06-06,South" },
];

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe("registerConnectedSource", () => {
  it("registers in reviewed mode with an audited named-actor event", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    expect(source.trust).toBe("review_queue"); // the phase-2 door stays closed
    expect(source.defaultClassification).toBe("internal");
    expect(source.syncSchedule).toBe("nightly");
    expect(isConnectedSource(source)).toBe(true);

    const events = await repo.listAdminEvents("ag-1");
    const reg = events.find((e) => e.kind === "connected_source_registered");
    expect(reg?.actorLabel).toBe("Dana");

    // The records-import lazy file-drop source is NOT a connected source.
    expect((await listConnectedSources(deps, "ag-1")).map((s) => s.id)).toEqual([source.id]);
  });
});

describe("registerConnectedSource — one file drop per agency", () => {
  it("refuses a second file-drop source (they would share a directory and duplicate every slice)", async () => {
    const { deps } = ctx();
    await registered(deps);
    await expect(
      registerConnectedSource(deps, { agencyId: "ag-1", actorUserId: "u-dana", name: "Another drop" }),
    ).rejects.toThrow(/already has a file-drop source/i);
  });

  it("allows network sources alongside the file drop — they have their own origins", async () => {
    const { deps } = ctx();
    await registered(deps);
    const { source } = await registerConnectedSource(deps, {
      agencyId: "ag-1",
      actorUserId: "u-dana",
      name: "Chicago open data",
      kind: "dataset_socrata",
      config: { domain: "data.cityofchicago.org", datasetId: "ygr5-vcbg", dataset: "towed-vehicles", dateField: "tow_date" },
    });
    expect(source.connectorKind).toBe("dataset_socrata");
    expect(source.type).toBe("scheduled_pull");
    expect((await listConnectedSources(deps, "ag-1"))).toHaveLength(2);
  });
});

describe("syncConnectedSource", () => {
  it("INVARIANT: every synced slice is born internal — sync cannot publish", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector(SWEEPING),
    );
    expect(result.created).toBe(2);
    const docs = (await repo.listDocuments("ag-1")).filter((d) => d.sourceId === source.id);
    expect(docs).toHaveLength(2);
    for (const d of docs) expect(d.classification).toBe("internal");
  });

  it("stamps provenance + recordDate the archive's date filter reads", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(SWEEPING));
    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    const meta = readDocumentMeta(june);
    expect(meta.title).toBe("Street Sweeping — 2026-06");
    expect(meta.recordDate).toBe("2026-06-30"); // period END — June record is a June record
    expect(meta.connectedSource).toMatchObject({
      sourceId: source.id,
      sourceName: "City open data",
      dataset: "street-sweeping",
      period: "2026-06",
    });
    expect(june.extractedText).toContain("South");
    expect(june.provenance).toBe("connector");
  });

  it("re-sync with unchanged content is a no-op (checksum diff)", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(SWEEPING));
    const again = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector(SWEEPING),
    );
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    // Quiet syncs write no admin event — one registration + one sync event.
    const syncs = (await repo.listAdminEvents("ag-1")).filter((e) => e.kind === "connected_source_synced");
    expect(syncs).toHaveLength(1);
  });

  it("INVARIANT: a changed slice keeps its human publication decision — re-sync can never unpublish", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(SWEEPING));
    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;

    // A named human publishes (what publicationService records).
    await repo.setDocumentClassification("ag-1", june.id, "public");
    await repo.updateDocument("ag-1", june.id, {
      metadata: { ...(june.metadata ?? {}), publicationDecision: { decision: "published", byUserId: "u-dana", byName: "Dana", at: "2026-08-13" } },
    });

    // The source ships fresher June data.
    const changed = [
      SWEEPING[0]!,
      { dataset: "street-sweeping", period: "2026-06", csv: "date,route\n2026-06-06,South\n2026-06-20,South" },
    ];
    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector(changed),
    );
    expect(result.updated).toBe(1);

    const after = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(after.classification).toBe("public"); // decision survives
    const meta = readDocumentMeta(after);
    expect(meta.publicationDecision?.byName).toBe("Dana"); // history survives
    expect(after.extractedText).toContain("2026-06-20"); // bytes are fresh
    expect(after.id).toBe(june.id); // same record, not a duplicate
  });

  it("flags PII-bearing slices so the queue warns before anyone publishes", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    const withPii = [
      { dataset: "vendor-contacts", period: "2026-06", csv: "name,ssn\nPat Doe,123-45-6789" },
    ];
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(withPii));
    const doc = (await repo.listDocuments("ag-1")).find((d) => d.sourceId === source.id)!;
    const meta = readDocumentMeta(doc);
    expect(meta.sensitivity).toBeTruthy();
    expect(Object.values(meta.sensitivity!).some((n) => n > 0)).toBe(true);
    expect(doc.classification).toBe("internal");
  });

  it("refuses infected slices item-granular; the rest of the batch lands", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    const mixed = [SWEEPING[0]!, { dataset: "bad", period: "2026-06", csv: EICAR }];
    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector(mixed),
    );
    expect(result.created).toBe(1);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]!.filename).toBe("bad.2026-06.csv");
    const docs = (await repo.listDocuments("ag-1")).filter((d) => d.sourceId === source.id);
    expect(docs).toHaveLength(1);
    // The refusal is visible on the source's sync state, not swallowed.
    const after = (await listConnectedSources(deps, "ag-1"))[0]!;
    expect(after.lastSyncStatus).toBe("ok");
    expect(after.lastSyncError).toContain("refused");
  });

  it("records sync bookkeeping the health/admin surface reads", async () => {
    const { deps } = ctx();
    const source = await registered(deps);
    expect(describeSyncState(source)).toBe("Never synced");
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(SWEEPING));
    const after = (await listConnectedSources(deps, "ag-1"))[0]!;
    expect(after.lastSyncStatus).toBe("ok");
    expect(after.lastSyncAt).not.toBeNull();
    expect(describeSyncState(after)).toBe("Synced");
  });
});

describe("pause / resume / delete", () => {
  it("pausing clears the schedule; resuming restores it; both audited", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    const paused = await setConnectedSourceSchedule(deps, {
      agencyId: "ag-1",
      actorUserId: "u-dana",
      sourceId: source.id,
      paused: true,
    });
    expect(paused.syncSchedule).toBeNull();
    expect(describeSyncState(paused)).toBe("Paused");
    const resumed = await setConnectedSourceSchedule(deps, {
      agencyId: "ag-1",
      actorUserId: "u-dana",
      sourceId: source.id,
      paused: false,
    });
    expect(resumed.syncSchedule).toBe("nightly");
    expect((await repo.listAdminEvents("ag-1")).filter((e) => e.kind === "connected_source_updated")).toHaveLength(2);
  });

  it("deleting the registration keeps every synced document in the corpus", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(SWEEPING));
    await deleteConnectedSource(deps, { agencyId: "ag-1", actorUserId: "u-dana", sourceId: source.id });
    expect(await listConnectedSources(deps, "ag-1")).toEqual([]);
    const docs = await repo.listDocuments("ag-1");
    expect(docs).toHaveLength(2); // the corpus survives, detached
    for (const d of docs) expect(d.sourceId).toBeNull();
  });
});

/* ==========================================================================
   PHASE 2 — standing publication and its four rails.
   ========================================================================== */

describe("row store (phase 3)", () => {
  it("sync materializes each slice's rows, dated by the row's own date field, and stamps rowStore", async () => {
    const { repo, deps } = ctx();
    await deps.repo.createUser(ADMIN);
    // HTTP kind so the config carries a dateField (file drop strips config —
    // its rows date by period end, which is the honest granularity there).
    const { source } = await registerConnectedSource(deps, {
      agencyId: "ag-1",
      actorUserId: "u-dana",
      name: "City open data",
      kind: "dataset_http",
      config: {
        url: "https://data.riverton.gov/sweeping.csv",
        dataset: "street-sweeping",
        dateField: "date",
      },
    });
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector(SWEEPING));

    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(readDocumentMeta(june).rowStore).toEqual({ rows: 1, complete: true });

    // Rows are invisible while the slice is internal (invariant 3)…
    const closed = await repo.searchPublicDatasetRows("ag-1", { dataset: "street-sweeping", limit: 10 });
    expect(closed.total).toBe(0);

    // …and appear the moment a named human publishes, with the row's OWN
    // date (2026-06-06), not just the slice's period end.
    await repo.setDocumentClassification("ag-1", june.id, "public");
    const open = await repo.searchPublicDatasetRows("ag-1", { dataset: "street-sweeping", limit: 10 });
    expect(open.total).toBe(1);
    expect(open.rows[0]!.recordDate).toBe("2026-06-06");
    expect(open.rows[0]!.data).toEqual({ date: "2026-06-06", route: "South" });
  });

  it("backfills slices that predate the row store from their stored CSV text", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    // A pre-phase-3 slice: connectedSource stamp, no rowStore key.
    await repo.createDocument({
      id: "doc-old",
      agencyId: "ag-1",
      sourceId: source.id,
      externalSystemId: "street-sweeping:2026-04",
      filename: "street-sweeping.2026-04.csv",
      classification: "public",
      recordType: "dataset",
      processingStatus: "ready",
      extractedText: "date,route\n2026-04-03,East\n2026-04-17,West",
      metadata: {
        title: "Street Sweeping — 2026-04",
        recordDate: "2026-04-30",
        connectedSource: {
          sourceId: source.id,
          sourceName: "City open data",
          dataset: "street-sweeping",
          period: "2026-04",
          checksum: "cafe",
          syncedAt: "2026-05-01T00:00:00.000Z",
        },
      },
      createdAt: new Date("2026-05-01T00:00:00Z"),
    });

    // A sync that pulls nothing new still converges the store.
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector([]));

    const doc = (await repo.listDocuments("ag-1")).find((d) => d.id === "doc-old")!;
    expect(readDocumentMeta(doc).rowStore).toEqual({ rows: 2, complete: true });
    const rows = await repo.listPublicDatasetRowsForDocument("ag-1", "doc-old", 10);
    expect(rows.map((r) => r.data.route)).toEqual(["East", "West"]);
    // A file-drop source names no date column, so rows date by the slice's
    // own recordDate — month granularity, which is what the slice honestly
    // knows. (An HTTP/Socrata backfill uses its configured dateField.)
    expect(rows[0]!.recordDate).toBe("2026-04-30");
  });

  it("a connector-truncated slice stores preview rows marked INCOMPLETE — tabular answers must refuse it", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    const truncatedConnector = {
      async listDatasets() {
        return [{ dataset: "street-sweeping", periods: ["2026-06"] }];
      },
      async fetchSlice() {
        return {
          dataset: "street-sweeping",
          period: "2026-06",
          recordDate: "2026-06-30",
          csv: Buffer.from("date,route\n2026-06-06,South", "utf8"),
          filename: "street-sweeping.2026-06.csv",
          columns: ["date", "route"],
          truncated: true, // the 100k SoQL cap hit — the slice is partial
        };
      },
      async probe() {
        return { ok: true };
      },
    };
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, truncatedConnector);
    const doc = (await repo.listDocuments("ag-1")).find((d) => d.sourceId === source.id)!;
    expect(readDocumentMeta(doc).rowStore).toEqual({ rows: 1, complete: false });
  });
});

describe("classifyNewSlice — the whole publicness decision, in one place", () => {
  const attestation = {
    byUserId: "u-dana",
    byName: "Dana",
    at: "2026-08-13T00:00:00.000Z",
    columns: ["date", "route"],
  };
  const slice = { columns: ["date", "route"] };

  it("reviewed mode (no attestation) never yields public", () => {
    expect(classifyNewSlice(undefined, slice, 0)).toEqual({ classification: "internal" });
  });

  it("a live attestation with a clean, matching slice yields public", () => {
    expect(classifyNewSlice(attestation, slice, 0)).toEqual({ classification: "public" });
  });

  it("RAIL 2: any PII finding quarantines, attestation or not", () => {
    expect(classifyNewSlice(attestation, slice, 1)).toEqual({
      classification: "internal",
      quarantined: "pii",
    });
  });

  it("RAIL 3: drifted columns quarantine AND kill the attestation", () => {
    expect(classifyNewSlice(attestation, { columns: ["date", "route", "operator"] }, 0)).toEqual({
      classification: "internal",
      quarantined: "schema_drift",
      drift: true,
    });
    // Reordering is drift too — the shape a human read is the ordered header.
    expect(classifyNewSlice(attestation, { columns: ["route", "date"] }, 0).drift).toBe(true);
  });
});

describe("standing publication (phase 2)", () => {
  const MAY = { dataset: "street-sweeping", period: "2026-05", csv: "date,route\n2026-05-02,North" };
  const JUNE = { dataset: "street-sweeping", period: "2026-06", csv: "date,route\n2026-06-06,South" };
  const JULY = { dataset: "street-sweeping", period: "2026-07", csv: "date,route\n2026-07-04,North" };

  /** Register, sync one period, then attest the dataset — the real order. */
  async function attested(deps: ConnectedDeps, repo: InMemoryRepository) {
    const source = await registered(deps);
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector([MAY]));
    const attestation = await attestDataset(deps, {
      agencyId: "ag-1",
      actorUserId: "u-dana",
      sourceId: source.id,
      dataset: "street-sweeping",
    });
    void repo;
    return { source, attestation };
  }

  it("attesting requires a synced slice to look at, and an admin", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    // Nothing synced yet — there is no column shape to attest to.
    await expect(
      attestDataset(deps, { agencyId: "ag-1", actorUserId: "u-dana", sourceId: source.id, dataset: "street-sweeping" }),
    ).rejects.toThrow(/sync this dataset at least once/i);

    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector([MAY]));
    await repo.createUser({ id: "u-coord", agencyId: "ag-1", email: "c@riverton.gov", name: "Coord", role: "coordinator", passwordHash: null });
    await expect(
      attestDataset(deps, { agencyId: "ag-1", actorUserId: "u-coord", sourceId: source.id, dataset: "street-sweeping" }),
    ).rejects.toThrow(/only an agency admin/i);
  });

  it("attesting records who, when, and the exact columns seen — and publishes nothing retroactively", async () => {
    const { repo, deps } = ctx();
    const { source, attestation } = await attested(deps, repo);
    expect(attestation.byName).toBe("Dana");
    expect(attestation.columns).toEqual(["date", "route"]);

    // RAIL 4 / INVARIANT 9: the already-synced May slice stays internal.
    // Attesting is not a bulk publish — that direction needs a named act.
    const may = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-05")!;
    expect(may.classification).toBe("internal");

    const events = await repo.listAdminEvents("ag-1");
    expect(events.find((e) => e.kind === "connected_dataset_attested")?.actorLabel).toBe("Dana");
    void source;
  });

  it("RAIL 1: future slices are born public and cite the attestation, per record", async () => {
    const { repo, deps } = ctx();
    const { source } = await attested(deps, repo);

    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector([MAY, JUNE, JULY]),
    );
    expect(result.autoPublished).toBe(2); // June + July; May was already here

    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(june.classification).toBe("public");
    const meta = readDocumentMeta(june);
    expect(meta.publicationDecision).toMatchObject({ decision: "published", byName: "Dana" });
    expect(meta.publicationDecision?.reason).toContain("Standing publication");

    // One audited publish event per record, naming the attesting human.
    const published = (await repo.listAdminEvents("ag-1")).filter((e) => e.kind === "document_published");
    expect(published).toHaveLength(2);
    expect(published[0]!.actorLabel).toBe("Dana");
    expect(published[0]!.payload).toMatchObject({ automated: true, attestedBy: "u-dana" });
  });

  it("RAIL 2: a PII-bearing slice is held back even under a live attestation", async () => {
    const { repo, deps } = ctx();
    const { source } = await attested(deps, repo);
    const withPii = { dataset: "street-sweeping", period: "2026-06", csv: "date,route\n2026-06-06,SSN 123-45-6789" };

    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector([withPii]),
    );
    expect(result.autoPublished).toBe(0);
    expect(result.quarantined).toEqual([{ dataset: "street-sweeping", period: "2026-06", why: "pii" }]);

    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(june.classification).toBe("internal");
    const meta = readDocumentMeta(june);
    expect(meta.connectedSource?.quarantined).toBe("pii");
    expect(meta.sensitivity).toBeTruthy();
    // The attestation survives a PII quarantine — this slice is the problem,
    // not the dataset's shape.
    expect(readSourceConfig((await listConnectedSources(deps, "ag-1"))[0]!).attestations["street-sweeping"]).toBeTruthy();
  });

  it("RAIL 3: drifted columns quarantine the slice and revoke the attestation", async () => {
    const { repo, deps } = ctx();
    const { source } = await attested(deps, repo);
    const drifted = { dataset: "street-sweeping", period: "2026-06", csv: "date,route,operator\n2026-06-06,South,Kim" };

    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector([drifted]),
    );
    expect(result.autoPublished).toBe(0);
    expect(result.driftRevoked).toEqual(["street-sweeping"]);

    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(june.classification).toBe("internal");
    expect(readDocumentMeta(june).connectedSource?.quarantined).toBe("schema_drift");

    // The attestation is gone from the source, and the office was told why.
    const after = (await listConnectedSources(deps, "ag-1"))[0]!;
    expect(readSourceConfig(after).attestations["street-sweeping"]).toBeUndefined();
    const revoked = (await repo.listAdminEvents("ag-1")).find(
      (e) => e.kind === "connected_dataset_attestation_revoked",
    );
    expect(revoked?.summary).toContain("columns changed");
    expect(after.lastSyncError).toContain("standing publication revoked");
  });

  it("INVARIANT: revoking stops publication on the very next sync", async () => {
    const { repo, deps } = ctx();
    const { source } = await attested(deps, repo);
    await revokeDatasetAttestation(deps, {
      agencyId: "ag-1",
      actorUserId: "u-dana",
      sourceId: source.id,
      dataset: "street-sweeping",
      reason: "council asked us to review it first",
    });

    const result = await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector([MAY, JUNE]),
    );
    expect(result.autoPublished).toBe(0);
    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(june.classification).toBe("internal");
  });

  it("INVARIANT 9: sync NEVER flips an existing internal document to public", async () => {
    const { repo, deps } = ctx();
    const source = await registered(deps);
    // June lands first, in reviewed mode → internal.
    await syncConnectedSource(deps, { agencyId: "ag-1", sourceId: source.id }, createMemoryConnector([JUNE]));
    await attestDataset(deps, { agencyId: "ag-1", actorUserId: "u-dana", sourceId: source.id, dataset: "street-sweeping" });

    // Now the same slice changes at the source AND the dataset is attested.
    const juneChanged = { dataset: "street-sweeping", period: "2026-06", csv: "date,route\n2026-06-06,South\n2026-06-20,South" };
    await syncConnectedSource(
      deps,
      { agencyId: "ag-1", sourceId: source.id },
      createMemoryConnector([juneChanged]),
    );

    const june = (await repo.listDocuments("ag-1")).find((d) => d.externalSystemId === "street-sweeping:2026-06")!;
    expect(june.classification).toBe("internal"); // still awaiting its human
    expect(june.extractedText).toContain("2026-06-20"); // but the bytes refreshed
  });
});
