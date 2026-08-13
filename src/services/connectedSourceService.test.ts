/**
 * Connected sources (docs/connected-sources.md phase 1). The invariant tests
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
  deleteConnectedSource,
  describeSyncState,
  isConnectedSource,
  listConnectedSources,
  registerConnectedSource,
  setConnectedSourceSchedule,
  syncConnectedSource,
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
