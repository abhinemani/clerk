/**
 * Publication-decision tests: the queue shows exactly the undecided unattached
 * internal docs, publishing is a named-human audited act that makes the doc
 * archive-visible, keeping internal records the decision without exposure,
 * and source trust/key management is audited.
 */
import { describe, expect, it } from "vitest";
import type { ServiceDeps } from "./deps";
import {
  InMemoryRepository,
  type Agency,
  type DocumentEntity,
  type UserEntity,
} from "./repository";
import {
  keepDocumentInternal,
  listPublicationQueues,
  publishDocument,
  rotateSourceApiKey,
  unpublishDocument,
  updateSourcePolicy,
} from "./publicationService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const STAFF: UserEntity = { id: "u-casey", agencyId: "ag-1", email: "casey@riverton.gov", name: "Casey", role: "coordinator", passwordHash: null };

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-05T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

function doc(id: string, over: Partial<DocumentEntity> = {}): DocumentEntity {
  return {
    id,
    agencyId: "ag-1",
    sourceId: "src-1",
    externalSystemId: null,
    provenance: "connector",
    filename: `${id}.pdf`,
    classification: "internal",
    recordType: null,
    processingStatus: "ready",
    metadata: { title: `Title ${id}` },
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

describe("listPublicationQueues", () => {
  it("splits undecided / published / kept-internal, excluding request-attached docs and release artifacts", async () => {
    const { repo, deps } = ctx();
    await repo.createDocument(doc("d-undecided"));
    await repo.createDocument(doc("d-public", { classification: "public" }));
    await repo.createDocument(
      doc("d-kept", { metadata: { publicationDecision: { decision: "internal", byUserId: "u", byName: "U", at: "2026-08-01" } } }),
    );
    await repo.createDocument(doc("d-attached"));
    await repo.createDocument(doc("d-burned", { externalSystemId: "redacted:whatever" }));
    await repo.createRequest({
      id: "r-1", agencyId: "ag-1", publicId: "PR-2026-00001", requesterId: null, status: "in_review",
      rawText: "x", interpretedScope: "x", recordTypes: [], complexityScore: null,
      receivedAt: new Date(), statutoryDueAt: null, closedAt: null, createdAt: new Date(),
    });
    await repo.linkRequestDocument("ag-1", "r-1", "d-attached");

    const q = await listPublicationQueues(deps, "ag-1");
    expect(q.undecided.map((d) => d.id)).toEqual(["d-undecided"]);
    expect(q.published.map((d) => d.id)).toEqual(["d-public"]);
    expect(q.keptInternal.map((d) => d.id)).toEqual(["d-kept"]);
  });
});

describe("publishDocument", () => {
  it("flips internal→public under a named human, records the decision, and audits", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-1", { metadata: { title: "Paving schedule", recordDate: "2026-05-20", tags: ["schedule"] } }));

    const published = await publishDocument(deps, {
      agencyId: "ag-1",
      actorUserId: "u-casey",
      documentId: "d-1",
      archiveMeta: { summary: "Summer resurfacing plan" },
    });

    expect(published.classification).toBe("public");
    expect(await repo.listPublicDocuments("ag-1")).toHaveLength(1);
    const meta = (await repo.getDocument("ag-1", "d-1"))!.metadata as Record<string, unknown>;
    expect(meta.title).toBe("Paving schedule");
    expect(meta.summary).toBe("Summer resurfacing plan");
    expect(meta.releasedOn).toBe("2026-05-20"); // the record's own date, not the publish date
    expect(meta.publicationDecision).toMatchObject({ decision: "published", byUserId: "u-casey", byName: "Casey" });

    const events = await repo.listAdminEvents("ag-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "record_published", actorLabel: "Casey" });
    expect(events[0]!.summary).toContain("Paving schedule");
  });

  it("refuses to publish a document in a request's review set — no side door around release review", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-attached"));
    await repo.createRequest({
      id: "r-1", agencyId: "ag-1", publicId: "PR-2026-00001", requesterId: null, status: "in_review",
      rawText: "x", interpretedScope: "x", recordTypes: [], complexityScore: null,
      receivedAt: new Date(), statutoryDueAt: null, closedAt: null, createdAt: new Date(),
    });
    await repo.linkRequestDocument("ag-1", "r-1", "d-attached");

    await expect(
      publishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-attached" }),
    ).rejects.toThrow(/review set/);
    expect((await repo.getDocument("ag-1", "d-attached"))!.classification).toBe("internal");
  });

  it("refuses release artifacts and unknown actors", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-burned", { externalSystemId: "redacted:doc-9" }));
    await expect(
      publishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-burned" }),
    ).rejects.toThrow(/release approval/);

    await repo.createDocument(doc("d-2"));
    await expect(
      publishDocument(deps, { agencyId: "ag-1", actorUserId: "u-ghost", documentId: "d-2" }),
    ).rejects.toThrow("User not found");
  });
});

describe("keepDocumentInternal", () => {
  it("records the decision (leaves the queue) but keeps the doc internal and staff-searchable", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-1"));

    await keepDocumentInternal(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-1" });

    const q = await listPublicationQueues(deps, "ag-1");
    expect(q.undecided).toHaveLength(0);
    expect(q.keptInternal.map((d) => d.id)).toEqual(["d-1"]);
    expect((await repo.getDocument("ag-1", "d-1"))!.classification).toBe("internal");
    expect(await repo.listPublicDocuments("ag-1")).toHaveLength(0); // never requester-visible
    expect(await repo.listDocuments("ag-1")).toHaveLength(1); // still in the staff corpus

    const events = await repo.listAdminEvents("ag-1");
    expect(events[0]).toMatchObject({ kind: "record_kept_internal", actorLabel: "Casey" });
  });
});

describe("unpublishDocument", () => {
  it("pulls a public record back to internal with a named actor and audited reason", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-1", { metadata: { title: "Oops report" } }));
    await publishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-1" });
    expect(await repo.listPublicDocuments("ag-1")).toHaveLength(1);

    const back = await unpublishDocument(deps, {
      agencyId: "ag-1",
      actorUserId: "u-casey",
      documentId: "d-1",
      reason: "Contains unredacted SSNs on page 3",
    });

    expect(back.classification).toBe("internal");
    expect(await repo.listPublicDocuments("ag-1")).toHaveLength(0); // gone from every public surface
    const meta = (await repo.getDocument("ag-1", "d-1"))!.metadata as Record<string, unknown>;
    expect(meta.publicationDecision).toMatchObject({
      decision: "internal",
      byName: "Casey",
      reason: "Contains unredacted SSNs on page 3",
    });
    // It lands in the kept-internal tab, not back in undecided.
    const q = await listPublicationQueues(deps, "ag-1");
    expect(q.undecided).toHaveLength(0);
    expect(q.keptInternal.map((d) => d.id)).toEqual(["d-1"]);

    const events = await repo.listAdminEvents("ag-1");
    const unpub = events.find((e) => e.kind === "record_unpublished");
    expect(unpub).toMatchObject({ actorLabel: "Casey" });
    expect(unpub!.summary).toContain("UNPUBLISHED");
    expect(unpub!.summary).toContain("SSNs");
  });

  it("requires a reason and refuses non-public docs", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-pub", { classification: "public" }));
    await expect(
      unpublishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-pub", reason: "   " }),
    ).rejects.toThrow(/reason/i);
    expect((await repo.getDocument("ag-1", "d-pub"))!.classification).toBe("public"); // untouched

    await repo.createDocument(doc("d-int"));
    await expect(
      unpublishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-int", reason: "x" }),
    ).rejects.toThrow(/not public/);
  });

  it("a record can be re-published after an unpublish — the decision cycle is audited both ways", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createDocument(doc("d-1", { metadata: { title: "Cycle" } }));
    await publishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-1" });
    await unpublishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-1", reason: "wrong doc" });
    await publishDocument(deps, { agencyId: "ag-1", actorUserId: "u-casey", documentId: "d-1" });

    expect((await repo.getDocument("ag-1", "d-1"))!.classification).toBe("public");
    const kinds = (await repo.listAdminEvents("ag-1")).map((e) => e.kind);
    expect(kinds).toEqual(["record_published", "record_unpublished", "record_published"]);
  });
});

describe("source management", () => {
  it("switches trust + default classification, audited", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createSource({
      id: "src-1", agencyId: "ag-1", name: "Agenda system", type: "api_push",
      apiKeyHash: "old-hash", trust: "review_queue", defaultClassification: "internal",
    });

    const updated = await updateSourcePolicy(deps, {
      agencyId: "ag-1", actorUserId: "u-casey", sourceId: "src-1",
      trust: "auto_publish", defaultClassification: "public",
    });
    expect(updated).toMatchObject({ trust: "auto_publish", defaultClassification: "public" });
    const events = await repo.listAdminEvents("ag-1");
    expect(events[0]!.kind).toBe("source_policy_changed");
    expect(events[0]!.summary).toContain("auto-publish");
  });

  it("rotates the API key: old key dead, new key live, raw key surfaced once", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    const { createHash } = await import("node:crypto");
    const oldHash = createHash("sha256").update("ck_old").digest("hex");
    await repo.createSource({
      id: "src-1", agencyId: "ag-1", name: "Ingestion API", type: "api_push",
      apiKeyHash: oldHash, trust: "auto_publish", defaultClassification: "public",
    });

    const { ingestKey } = await rotateSourceApiKey(deps, { agencyId: "ag-1", actorUserId: "u-casey", sourceId: "src-1" });
    expect(ingestKey).toMatch(/^ck_/);

    expect(await repo.findSourceByApiKeyHash("ag-1", oldHash)).toBeNull(); // old key refused
    const newHash = createHash("sha256").update(ingestKey).digest("hex");
    expect((await repo.findSourceByApiKeyHash("ag-1", newHash))?.id).toBe("src-1"); // new key works

    const events = await repo.listAdminEvents("ag-1");
    expect(events[0]!.kind).toBe("source_key_rotated");
    // The raw key never lands in the audit payload.
    expect(JSON.stringify(events[0])).not.toContain(ingestKey);
  });

  it("refuses to rotate a key on a keyless file-drop source", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(STAFF);
    await repo.createSource({
      id: "src-fd", agencyId: "ag-1", name: "File drop", type: "file_drop",
      apiKeyHash: null, trust: "review_queue", defaultClassification: "internal",
    });
    await expect(
      rotateSourceApiKey(deps, { agencyId: "ag-1", actorUserId: "u-casey", sourceId: "src-fd" }),
    ).rejects.toThrow(/API sources/);
  });
});
