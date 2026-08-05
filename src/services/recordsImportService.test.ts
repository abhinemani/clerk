/**
 * Records import tests: bulk imports NEVER land public (the invariant), bytes
 * go through the virus scan fail-closed, external ids make re-imports update
 * in place, and the batch is audited under the importing admin's name.
 */
import { describe, expect, it } from "vitest";
import { BuiltinScanner } from "@/adapters/virusScan";
import type { BlobStore, StoredBlob } from "@/adapters/blobStore";
import { parseRecordsCsv } from "@/domain/recordsImport";
import type { ServiceDeps } from "./deps";
import { InMemoryRepository, type Agency, type UserEntity } from "./repository";
import { ensureFileDropSource, importRecords } from "./recordsImportService";

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
    now: () => new Date("2026-08-05T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
    blobStore,
    virusScanner: new BuiltinScanner(),
  };
  return { repo, deps, blobStore };
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

describe("importRecords", () => {
  it("lands every row internal — even nothing in the CSV can say public", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const { rows } = parseRecordsCsv(
      ["title,summary,date,record_type,tags", 'Council agenda,June session,2026-06-02,agenda,"council"', "Paving schedule,,2026-05-20,schedule,"].join("\n"),
    );
    const result = await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });

    expect(result.failed).toEqual([]);
    expect(result.imported).toHaveLength(2);
    const docs = await repo.listDocuments("ag-1");
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.classification === "internal")).toBe(true);
    expect(docs.every((d) => d.provenance === "connector")).toBe(true);
    expect(await repo.listPublicDocuments("ag-1")).toHaveLength(0);

    // Metadata carries the CSV fields for the later publish form.
    const agendaDoc = docs.find((d) => (d.metadata as { title?: string }).title === "Council agenda")!;
    expect(agendaDoc.metadata).toMatchObject({ title: "Council agenda", summary: "June session", tags: ["council"], recordDate: "2026-06-02" });
    expect(agendaDoc.recordType).toBe("agenda");
  });

  it("creates the file-drop source lazily, once, with review-queue trust", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const s1 = await ensureFileDropSource(deps, "ag-1");
    const s2 = await ensureFileDropSource(deps, "ag-1");
    expect(s1.id).toBe(s2.id);
    expect(s1).toMatchObject({ type: "file_drop", trust: "review_queue", defaultClassification: "internal" });
    expect(await repo.listSources("ag-1")).toHaveLength(1);
  });

  it("stores matched file bytes (scanned, checksummed, text-extracted); missing files import metadata-only", async () => {
    const { repo, deps, blobStore } = ctx();
    await repo.createUser(ADMIN);
    const { rows } = parseRecordsCsv(
      ["title,filename", "With file,report.txt", "Missing file,ghost.pdf"].join("\n"),
    );
    const files = new Map([["archive/report.txt", { bytes: Buffer.from("Line one\nLine two"), mimeType: null }]]);
    const result = await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows, files });

    expect(result.imported).toHaveLength(2);
    expect(result.missingFiles).toEqual(["ghost.pdf"]);
    const docs = await repo.listDocuments("ag-1");
    const withFile = docs.find((d) => d.filename === "report.txt")!;
    expect(withFile.blobRef).toBeTruthy();
    expect(withFile.checksum).toHaveLength(64);
    expect(withFile.extractedText).toBe("Line one\nLine two");
    expect(blobStore.blobs.get(withFile.blobRef!)?.bytes.toString()).toBe("Line one\nLine two");
    const metaOnly = docs.find((d) => d.filename === "ghost.pdf")!;
    expect(metaOnly.blobRef ?? undefined).toBeUndefined();
  });

  it("refuses an infected ZIP member (fail-closed) without sinking the batch", async () => {
    const { repo, deps, blobStore } = ctx();
    await repo.createUser(ADMIN);
    const { rows } = parseRecordsCsv(["title,filename", "Bad,evil.txt", "Good,fine.txt"].join("\n"));
    const files = new Map([
      ["evil.txt", { bytes: Buffer.from(EICAR), mimeType: null }],
      ["fine.txt", { bytes: Buffer.from("harmless"), mimeType: null }],
    ]);
    const result = await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows, files });

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.reason).toContain("virus scan");
    expect(result.imported).toHaveLength(1);
    // The infected bytes never touched the blob store.
    for (const blob of blobStore.blobs.values()) {
      expect(blob.bytes.toString("latin1")).not.toContain("EICAR-STANDARD");
    }
  });

  it("stamps deterministic PII tallies so the queue can warn before publish", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const { rows } = parseRecordsCsv(["title,filename", "HR roster,roster.txt", "Clean doc,clean.txt"].join("\n"));
    const files = new Map([
      ["roster.txt", { bytes: Buffer.from("Employee SSN: 123-45-6789 call 555-867-5309"), mimeType: null }],
      ["clean.txt", { bytes: Buffer.from("Nothing sensitive in this schedule."), mimeType: null }],
    ]);
    await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows, files });

    const docs = await repo.listDocuments("ag-1");
    const flagged = docs.find((d) => d.filename === "roster.txt")!;
    const sensitivity = (flagged.metadata as { sensitivity?: Record<string, number> }).sensitivity;
    expect(sensitivity?.ssn).toBeGreaterThanOrEqual(1);
    const clean = docs.find((d) => d.filename === "clean.txt")!;
    expect((clean.metadata as { sensitivity?: unknown }).sensitivity).toBeUndefined();
  });

  it("re-importing the same external_id updates in place instead of duplicating", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const first = parseRecordsCsv("external_id,title\nR-1,Original title").rows;
    const second = parseRecordsCsv("external_id,title\nR-1,Corrected title").rows;

    await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows: first });
    const result = await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows: second });

    expect(result.imported[0]!.updated).toBe(true);
    const docs = await repo.listDocuments("ag-1");
    expect(docs).toHaveLength(1);
    expect((docs[0]!.metadata as { title?: string }).title).toBe("Corrected title");
  });

  it("audits the batch as ONE admin event naming the importer", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const { rows } = parseRecordsCsv("title\nOne\nTwo\nThree");
    await importRecords(deps, { agencyId: "ag-1", actorUserId: "u-dana", rows });

    const events = await repo.listAdminEvents("ag-1");
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("records_imported");
    expect(events[0]!.actorLabel).toBe("Dana");
    expect(events[0]!.summary).toContain("Imported 3 record(s)");
  });

  it("refuses an unknown actor — imports are a named human's act", async () => {
    const { deps } = ctx();
    const { rows } = parseRecordsCsv("title\nOne");
    await expect(importRecords(deps, { agencyId: "ag-1", actorUserId: "nobody", rows })).rejects.toThrow(
      "User not found",
    );
  });
});
