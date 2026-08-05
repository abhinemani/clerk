/**
 * Staff records-search tests (§6.4): full-corpus scope for staff, burned
 * artifacts hidden, attach is idempotent and audited.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type DocumentEntity, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { attachDocumentToRequest, searchAgencyRecords } from "./recordsSearchService";
import { submitRequest } from "./requestService";

const AGENCY = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };

const doc = (overrides: Partial<DocumentEntity>): DocumentEntity => ({
  id: "d-1",
  agencyId: "ag-1",
  sourceId: null,
  externalSystemId: null,
  filename: "file.txt",
  classification: "internal",
  recordType: null,
  processingStatus: "ready",
  metadata: null,
  createdAt: new Date("2026-07-30T12:00:00Z"),
  ...overrides,
});

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-07-30T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

describe("searchAgencyRecords", () => {
  it("finds internal documents by extracted text — the staff-only full scope", async () => {
    const { repo } = ctx();
    await repo.createDocument(
      doc({ id: "d-memo", filename: "payment-memo.docx", extractedText: "Bright Path invoice dispute Maple Avenue" }),
    );
    await repo.createDocument(
      doc({ id: "d-other", filename: "unrelated.txt", extractedText: "park bench donation program" }),
    );
    const hits = await searchAgencyRecords({ repo }, { agencyId: "ag-1", query: "maple invoice" });
    expect(hits.map((h) => h.documentId)).toEqual(["d-memo"]);
    expect(hits[0]!.classification).toBe("internal");
    expect(hits[0]!.whyMatched).toContain("maple");
  });

  it("searches filename and archive metadata too, and hides burned artifacts", async () => {
    const { repo } = ctx();
    await repo.createDocument(
      doc({ id: "d-arch", filename: "acme-contract.pdf", classification: "public", metadata: { title: "Acme Paving Contract", keywords: ["paving"] } }),
    );
    await repo.createDocument(
      doc({ id: "d-burned", filename: "redacted-claim.pdf", externalSystemId: "redacted:xyz", extractedText: "paving claim details" }),
    );
    const hits = await searchAgencyRecords({ repo }, { agencyId: "ag-1", query: "paving" });
    expect(hits.map((h) => h.documentId)).toEqual(["d-arch"]);
  });

  it("marks documents already in the target request's review set", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "sidewalk records" });
    await repo.createDocument(doc({ id: "d-in", extractedText: "sidewalk panel twelve" }));
    await repo.createDocument(doc({ id: "d-out", filename: "b.txt", extractedText: "sidewalk panel fourteen" }));
    await repo.linkRequestDocument("ag-1", r.id, "d-in");

    const hits = await searchAgencyRecords({ repo }, { agencyId: "ag-1", query: "sidewalk", forRequestId: r.id });
    const byId = new Map(hits.map((h) => [h.documentId, h.alreadyAttached]));
    expect(byId.get("d-in")).toBe(true);
    expect(byId.get("d-out")).toBe(false);
  });
});

describe("attachDocumentToRequest", () => {
  const user: UserEntity = {
    id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "admin", passwordHash: null,
  };

  it("links the document, logs a named-actor event, and is idempotent", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(user);
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1", filename: "found.txt" }));

    await attachDocumentToRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "d-1", actorUserId: "u-dana" });
    await attachDocumentToRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "d-1", actorUserId: "u-dana" });

    const linked = await repo.listRequestDocuments("ag-1", r.id);
    expect(linked.map((d) => d.id)).toEqual(["d-1"]);
    const events = await repo.listEvents("ag-1", r.id);
    const attach = events.filter((e) => e.payload?.source === "records_search");
    expect(attach).toHaveLength(1);
    expect(attach[0]!.actorUserId).toBe("u-dana");
    expect(attach[0]!.summary).toContain("Dana attached found.txt");
  });

  it("rejects unknown documents and requests", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(user);
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await expect(
      attachDocumentToRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "nope", actorUserId: "u-dana" }),
    ).rejects.toThrow(/Document/);
    await expect(
      attachDocumentToRequest(deps, { agencyId: "ag-1", requestId: "nope", documentId: "d-1", actorUserId: "u-dana" }),
    ).rejects.toThrow(/Request/);
  });
});

describe("hybrid search — the vector half (§6.4)", () => {
  /** Fake vectors: same "topic" word ⇒ similar vector, no API needed. */
  function topicVector(text: string): number[] {
    const topics = ["fall", "injury", "paving", "budget"];
    const lower = text.toLowerCase();
    return topics.map((t) => (lower.includes(t) ? 1 : 0));
  }

  it("finds a document by MEANING when no keyword overlaps", async () => {
    const { repo } = ctx();
    await repo.createDocument(
      doc({
        id: "d-claim",
        filename: "claim-2026-0044.pdf",
        extractedText: "Claimant caught his shoe on a raised joint and fell forward, fracturing a wrist.",
      }),
    );
    await repo.createDocument(
      doc({ id: "d-budget", filename: "budget.pdf", extractedText: "Adopted budget allocations by department." }),
    );

    // Body chunks with topic vectors — "fall" is the shared concept.
    await repo.setDocumentBodyChunks("ag-1", "d-claim", [
      { content: "Claimant caught his shoe and fell forward, fracturing a wrist.", embedding: topicVector("fall injury") },
    ]);
    await repo.setDocumentBodyChunks("ag-1", "d-budget", [
      { content: "Adopted budget allocations.", embedding: topicVector("budget") },
    ]);

    // Lexically, "fall" appears in neither title nor metadata of d-claim's
    // corpus doc beyond the text itself — the vector half is what ranks it.
    const hits = await searchAgencyRecords({ repo }, { agencyId: "ag-1", query: "trip and fall" });
    expect(hits[0]!.documentId).toBe("d-claim");
  });

  it("degrades to lexical-only when nothing is embedded", async () => {
    const { repo } = ctx();
    await repo.createDocument(
      doc({ id: "d-1", filename: "paving.pdf", extractedText: "Acme paving contract for Main Street." }),
    );
    const hits = await searchAgencyRecords({ repo }, { agencyId: "ag-1", query: "paving" });
    expect(hits.map((h) => h.documentId)).toEqual(["d-1"]);
  });
});
