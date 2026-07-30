/**
 * Archive download resolution — an entry's Download link must point at real
 * bytes: its own blob, or the frozen artifacts of the PUBLIC release that
 * created it. Metadata-only entries (and private releases) resolve to null —
 * the archive never advertises what the /files gate wouldn't serve.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type DocumentEntity } from "@/services/repository";
import { buildArchiveRecord, resolveArchiveDownloadUrl } from "./archive";

const AG = "ag-1";

function doc(overrides: Partial<DocumentEntity>): DocumentEntity {
  return {
    id: overrides.id ?? "doc-1",
    agencyId: AG,
    sourceId: null,
    externalSystemId: null,
    filename: "record.pdf",
    classification: "public",
    recordType: null,
    processingStatus: "ready",
    metadata: null,
    createdAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("resolveArchiveDownloadUrl", () => {
  it("a blob-backed entry serves itself", async () => {
    const repo = new InMemoryRepository();
    const d = doc({ id: "doc-blob", blobRef: "ag-1/x.pdf", byteSize: 42 });
    expect(await resolveArchiveDownloadUrl(repo, AG, "riverton", d)).toBe(
      "/riverton/files/doc-blob",
    );
  });

  it("a release-born entry serves the release's frozen artifact", async () => {
    const repo = new InMemoryRepository();
    await repo.createRelease({
      id: "rel-1",
      agencyId: AG,
      requestId: "req-1",
      artifacts: [
        { blobRef: "ag-1/burned.pdf", filename: "burned.pdf", checksum: "cc", documentId: "artifact-doc" },
      ],
      responseLetter: null,
      visibility: "public",
      approvedByUserId: "staff-1",
      releasedAt: new Date(),
    });
    const d = doc({ id: "archive-entry", metadata: { releaseId: "rel-1" } });
    expect(await resolveArchiveDownloadUrl(repo, AG, "riverton", d)).toBe(
      "/riverton/files/artifact-doc",
    );
  });

  it("a PRIVATE release's artifacts are never advertised", async () => {
    const repo = new InMemoryRepository();
    await repo.createRelease({
      id: "rel-priv",
      agencyId: AG,
      requestId: "req-1",
      artifacts: [{ blobRef: "b", filename: "f", checksum: "c", documentId: "artifact-doc" }],
      responseLetter: null,
      visibility: "private",
      approvedByUserId: "staff-1",
      releasedAt: new Date(),
    });
    const d = doc({ id: "e", metadata: { releaseId: "rel-priv" } });
    expect(await resolveArchiveDownloadUrl(repo, AG, "riverton", d)).toBeNull();
  });

  it("metadata-only entries and cross-tenant releases resolve to null", async () => {
    const repo = new InMemoryRepository();
    expect(await resolveArchiveDownloadUrl(repo, AG, "riverton", doc({ id: "meta-only" }))).toBeNull();

    await repo.createRelease({
      id: "rel-other",
      agencyId: "ag-2", // another tenant's release
      requestId: "r",
      artifacts: [{ blobRef: "b", filename: "f", checksum: "c", documentId: "d" }],
      responseLetter: null,
      visibility: "public",
      approvedByUserId: "u",
      releasedAt: new Date(),
    });
    const cross = doc({ id: "x", metadata: { releaseId: "rel-other" } });
    expect(await resolveArchiveDownloadUrl(repo, AG, "riverton", cross)).toBeNull();
  });
});

describe("buildArchiveRecord — the permalink resolver", () => {
  it("INVARIANT 3: internal documents resolve to null, exactly like nonexistent ones", async () => {
    const repo = new InMemoryRepository();
    await repo.createDocument(doc({ id: "d-internal", classification: "internal", extractedText: "MARKER-SECRET" }));
    expect(await buildArchiveRecord(repo, AG, "riverton", "d-internal")).toBeNull();
    expect(await buildArchiveRecord(repo, AG, "riverton", "d-nonexistent")).toBeNull();
  });

  it("returns the full record for a public document, with text and download", async () => {
    const repo = new InMemoryRepository();
    await repo.createDocument(
      doc({
        id: "d-pub",
        blobRef: "ag-1/minutes.pdf",
        byteSize: 99,
        recordType: "meeting minutes",
        extractedText: "Council approved the budget.",
        pageCount: 3,
        metadata: { title: "March Council Minutes", summary: "Adopted budget.", tags: ["minutes"], releasedOn: "2026-03-04" },
      }),
    );
    const record = await buildArchiveRecord(repo, AG, "riverton", "d-pub");
    expect(record?.title).toBe("March Council Minutes");
    expect(record?.downloadUrl).toBe("/riverton/files/d-pub");
    expect(record?.extractedText).toContain("Council approved");
    expect(record?.pageCount).toBe(3);
    expect(record?.sourceRequestPublicId).toBeNull();
  });

  it("links a release-born record back to its source request", async () => {
    const repo = new InMemoryRepository();
    await repo.createRequest({
      id: "req-1", agencyId: AG, publicId: "PR-2026-00042", requesterId: null, status: "fulfilled",
      rawText: "x", interpretedScope: null, recordTypes: [], complexityScore: null,
      receivedAt: new Date(), statutoryDueAt: null, closedAt: new Date(), createdAt: new Date(),
    });
    await repo.createRelease({
      id: "rel-1", agencyId: AG, requestId: "req-1", visibility: "public",
      artifacts: [{ documentId: "d-artifact", filename: "released.pdf", blobRef: "ag-1/released.pdf", checksum: "abc" }],
      responseLetter: null, approvedByUserId: "u-1", releasedAt: new Date(),
    });
    await repo.createDocument(doc({ id: "d-entry", metadata: { releaseId: "rel-1" } }));
    const record = await buildArchiveRecord(repo, AG, "riverton", "d-entry");
    expect(record?.sourceRequestPublicId).toBe("PR-2026-00042");
    expect(record?.downloadUrl).toBe("/riverton/files/d-artifact");
  });
});
