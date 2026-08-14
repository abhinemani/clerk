/**
 * Repository conformance suite — the SAME assertions run against BOTH adapters
 * (InMemory, which every service test trusts, and Drizzle over embedded
 * PGlite, which production runs). The port has two implementations; anything
 * one does that the other doesn't is a bug that unit tests can't see, because
 * they only ever exercise InMemory. This suite is where that class of bug dies
 * — e.g. the connector upsert silently dropping blob fields on the Drizzle
 * path only (fixed 2026-08-05; pinned below).
 *
 * Every test seeds through the port itself (createAgency/createUser/…), so
 * both adapters get identical setup. Tests share one repo per adapter (PGlite
 * boot + migrations aren't free) and use fresh UUIDs per test for isolation.
 */
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import { DrizzleRepository } from "@/db/repository/drizzleRepository";
import {
  InMemoryRepository,
  NotFoundError,
  type DocumentEntity,
  type Repository,
} from "@/services/repository";

const AG1 = "aaaaaaaa-0000-4000-8000-000000000001";
const AG2 = "aaaaaaaa-0000-4000-8000-000000000002";
const USER1 = "bbbbbbbb-0000-4000-8000-000000000001";
const DEPT1 = "cccccccc-0000-4000-8000-000000000001";
const DEPT2 = "cccccccc-0000-4000-8000-000000000002";

const uid = () => crypto.randomUUID();

/** Identical seed for both adapters, through the port itself. */
async function seed(repo: Repository): Promise<Repository> {
  await repo.createAgency({ id: AG1, slug: "conf-riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] });
  await repo.createAgency({ id: AG2, slug: "conf-other", name: "Other City", stateCode: "TX", observedHolidays: [] });
  await repo.createUser({ id: USER1, agencyId: AG1, email: "conf@riverton.gov", name: "Conf", role: "coordinator", passwordHash: null });
  await repo.createDepartment({ id: DEPT1, agencyId: AG1, name: "Public Works", defaultResponderEmails: [] });
  await repo.createDepartment({ id: DEPT2, agencyId: AG2, name: "Other Dept", defaultResponderEmails: [] });
  return repo;
}

function docOf(over: Partial<DocumentEntity> = {}): DocumentEntity {
  return {
    id: uid(),
    agencyId: AG1,
    sourceId: null,
    externalSystemId: null,
    filename: "conf.pdf",
    classification: "internal",
    recordType: null,
    processingStatus: "ready",
    metadata: {},
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

function requestOf(over: Partial<import("@/services/repository").RequestEntity> = {}) {
  return {
    id: uid(),
    agencyId: AG1,
    publicId: `PR-2026-${Math.floor(Math.random() * 90000) + 10000}`,
    requesterId: null,
    status: "in_review" as const,
    rawText: "conformance",
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: new Date("2026-08-01T00:00:00Z"),
    statutoryDueAt: null,
    closedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

function conformance(adapterName: string, makeRepo: () => Promise<Repository>) {
  describe(`repository conformance — ${adapterName}`, () => {
    let repo: Repository;
    beforeAll(async () => {
      repo = await makeRepo();
    });

    // --- agencies ------------------------------------------------------------

    it("agency: slug lookup and settings/branding patch round-trip", async () => {
      expect((await repo.getAgencyBySlug("conf-riverton"))?.id).toBe(AG1);
      const updated = await repo.updateAgency(AG1, {
        settings: { publicRequestLog: true, statuteReview: { reviewedBy: "Counsel", reviewedOn: "2026-07-01" } },
        branding: { officeName: "Records Div", accentColor: "#1e3a5f" },
      });
      expect(updated.settings?.publicRequestLog).toBe(true);
      const back = await repo.getAgency(AG1);
      expect(back?.settings?.statuteReview?.reviewedBy).toBe("Counsel");
      expect(back?.branding?.officeName).toBe("Records Div");
      expect((await repo.listAgencies()).map((a) => a.id)).toEqual(expect.arrayContaining([AG1, AG2]));
    });

    it("agency: display-name patch round-trips; slug and other tenants untouched", async () => {
      const before = await repo.getAgency(AG1);
      const otherBefore = await repo.getAgency(AG2);
      const renamed = await repo.updateAgency(AG1, { name: "City of Conf-Riverton (renamed)" });
      expect(renamed.name).toBe("City of Conf-Riverton (renamed)");
      expect(renamed.slug).toBe(before!.slug);
      expect((await repo.getAgency(AG1))?.name).toBe("City of Conf-Riverton (renamed)");
      // A settings-only patch must never blank the name.
      await repo.updateAgency(AG1, { settings: { publicRequestLog: true } });
      expect((await repo.getAgency(AG1))?.name).toBe("City of Conf-Riverton (renamed)");
      expect((await repo.getAgency(AG2))?.name).toBe(otherBefore!.name);
    });

    // --- users / requesters --------------------------------------------------

    it("users: email lookup and patches are tenant-scoped", async () => {
      const u = await repo.createUser({ id: uid(), agencyId: AG1, email: "scope@riverton.gov", name: null, role: "reviewer", passwordHash: null });
      expect((await repo.findUserByEmail(AG1, "scope@riverton.gov"))?.id).toBe(u.id);
      expect(await repo.findUserByEmail(AG2, "scope@riverton.gov")).toBeNull();
      expect(await repo.getUser(AG2, u.id)).toBeNull();
      expect((await repo.updateUser(AG1, u.id, { role: "admin" })).role).toBe("admin");
      await expect(repo.updateUser(AG2, u.id, { role: "admin" })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("requesters: email lookup and verification patch, tenant-scoped", async () => {
      const r = await repo.createRequester({ id: uid(), agencyId: AG1, email: "res@ex.com", name: "Res", type: "individual", passwordHash: null, emailVerifiedAt: null });
      expect((await repo.findRequesterByEmail(AG1, "res@ex.com"))?.id).toBe(r.id);
      expect(await repo.findRequesterByEmail(AG2, "res@ex.com")).toBeNull();
      const verified = await repo.updateRequester(AG1, r.id, { emailVerifiedAt: new Date() });
      expect(verified.emailVerifiedAt).not.toBeNull();
    });

    // --- departments + memberships ------------------------------------------

    it("departments: update is tenant-scoped; memberships drop cross-tenant ids", async () => {
      await expect(repo.updateDepartment(AG2, DEPT1, { name: "Hijack" })).rejects.toBeInstanceOf(NotFoundError);
      // DEPT2 belongs to AG2 — setting it for an AG1 user must not stick.
      await repo.setUserDepartments(AG1, USER1, [DEPT1, DEPT2]);
      expect(await repo.listUserDepartmentIds(AG1, USER1)).toEqual([DEPT1]);
      expect(await repo.listUserDepartmentIds(AG2, USER1)).toEqual([]); // cross-tenant read
    });

    // --- public-id sequence --------------------------------------------------

    it("public-id sequence: independent per agency and per year", async () => {
      const a = await repo.nextPublicIdSeq(AG1, 2031);
      const b = await repo.nextPublicIdSeq(AG1, 2031);
      const otherYear = await repo.nextPublicIdSeq(AG1, 2032);
      const otherAgency = await repo.nextPublicIdSeq(AG2, 2031);
      expect(b).toBe(a + 1);
      expect(otherYear).toBe(1);
      expect(otherAgency).toBe(1);
    });

    // --- requests ------------------------------------------------------------

    it("requests: round-trip, public-id lookup, jsonb patches, tenant scoping", async () => {
      const r = await repo.createRequest(requestOf({ publicId: "PR-2031-00001" }));
      expect(await repo.getRequest(AG2, r.id)).toBeNull();
      expect((await repo.findRequestByPublicId(AG1, "PR-2031-00001"))?.id).toBe(r.id);
      expect(await repo.findRequestByPublicId(AG2, "PR-2031-00001")).toBeNull();

      await repo.updateRequest(AG1, r.id, {
        statutoryDueAt: new Date("2026-09-01T00:00:00Z"),
        extensionHistory: [{ at: "2026-08-01T00:00:00Z", byUserId: USER1, days: 10, reason: "voluminous" }],
        forwardedTo: { agencyId: AG2, agencySlug: "conf-other", agencyName: "Other City", requestId: uid(), publicId: "PR-2026-00009", at: "2026-08-01T00:00:00Z" },
      });
      const back = await repo.getRequest(AG1, r.id);
      expect(back?.extensionHistory?.[0]?.reason).toBe("voluminous");
      expect(back?.forwardedTo?.agencySlug).toBe("conf-other");
      await expect(repo.updateRequest(AG2, r.id, { status: "closed" })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("requests: ask-vector round-trip, tenancy, and null-embedding exclusion", async () => {
      const r = await repo.createRequest(requestOf());
      const other = await repo.createRequest(requestOf()); // never embedded
      const vec = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));
      await repo.setRequestEmbedding(AG1, r.id, vec);
      const listed = await repo.listRequestEmbeddings(AG1);
      const mine = listed.find((x) => x.id === r.id);
      expect(mine?.embedding.slice(0, 3)).toEqual([1, 0, 0]);
      expect(mine?.embedding).toHaveLength(1024);
      // Unembedded requests don't appear as nulls; other tenants see nothing.
      expect(listed.some((x) => x.id === other.id)).toBe(false);
      expect((await repo.listRequestEmbeddings(AG2)).some((x) => x.id === r.id)).toBe(false);
      await expect(repo.setRequestEmbedding(AG2, r.id, vec)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("requests: listRequests newest-first; listRequestsByRequester scoped", async () => {
      const requester = await repo.createRequester({ id: uid(), agencyId: AG1, email: null, name: "Lister", type: "individual" });
      const older = await repo.createRequest(requestOf({ createdAt: new Date("2026-01-01T00:00:00Z"), requesterId: requester.id }));
      const newer = await repo.createRequest(requestOf({ createdAt: new Date("2026-06-01T00:00:00Z"), requesterId: requester.id }));
      const all = await repo.listRequests(AG1);
      expect(all.findIndex((x) => x.id === newer.id)).toBeLessThan(all.findIndex((x) => x.id === older.id));
      expect((await repo.listRequestsByRequester(AG1, requester.id)).map((x) => x.id)).toEqual([newer.id, older.id]);
      expect(await repo.listRequestsByRequester(AG2, requester.id)).toEqual([]);
    });

    // --- events (append-only audit) -----------------------------------------

    it("events: append + list oldest-first, tenant-scoped", async () => {
      const r = await repo.createRequest(requestOf());
      await repo.appendEvent({ id: uid(), agencyId: AG1, requestId: r.id, kind: "status_change", actorUserId: USER1, summary: "second", createdAt: new Date("2026-08-02T00:00:00Z") });
      await repo.appendEvent({ id: uid(), agencyId: AG1, requestId: r.id, kind: "note", actorUserId: null, summary: "first", payload: { k: "v" }, createdAt: new Date("2026-08-01T00:00:00Z") });
      const events = await repo.listEvents(AG1, r.id);
      expect(events.map((e) => e.summary)).toEqual(["first", "second"]);
      expect(events[0]?.payload).toEqual({ k: "v" });
      expect(await repo.listEvents(AG2, r.id)).toEqual([]);
    });

    // --- documents: the corpus ----------------------------------------------

    it("documents: full field round-trip including blob, retention, and provenance", async () => {
      const d = await repo.createDocument(
        docOf({
          provenance: "connector",
          blobRef: "ag1/key-1",
          byteSize: 1234,
          mimeType: "application/pdf",
          checksum: "c".repeat(64),
          extractedText: "line one\nline two",
          pageCount: 2,
          retentionUntil: new Date("2030-01-01T00:00:00Z"),
          legalHoldReason: "litigation X",
          metadata: { title: "T", tags: ["a"] },
        }),
      );
      const back = await repo.getDocument(AG1, d.id);
      expect(back).toMatchObject({
        provenance: "connector",
        blobRef: "ag1/key-1",
        byteSize: 1234,
        mimeType: "application/pdf",
        extractedText: "line one\nline two",
        pageCount: 2,
        legalHoldReason: "litigation X",
      });
      expect(back?.retentionUntil?.toISOString().slice(0, 10)).toBe("2030-01-01");
      expect(back?.metadata).toEqual({ title: "T", tags: ["a"] });
      expect(await repo.getDocument(AG2, d.id)).toBeNull(); // tenant isolation
    });

    it("documents: updateDocument patches narrow fields and only those", async () => {
      const d = await repo.createDocument(docOf({ extractedText: "orig", metadata: { title: "Keep" } }));
      await repo.updateDocument(AG1, d.id, { processingStatus: "held", pageCount: 9, legalHoldReason: "hold" });
      const back = await repo.getDocument(AG1, d.id);
      expect(back?.processingStatus).toBe("held");
      expect(back?.pageCount).toBe(9);
      expect(back?.legalHoldReason).toBe("hold");
      expect(back?.extractedText).toBe("orig"); // untouched
      expect(back?.metadata).toEqual({ title: "Keep" });
      await expect(repo.updateDocument(AG2, d.id, { pageCount: 1 })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("setDocumentClassification: the one sanctioned flip, tenant-scoped", async () => {
      const d = await repo.createDocument(docOf());
      const flipped = await repo.setDocumentClassification(AG1, d.id, "public");
      expect(flipped.classification).toBe("public");
      expect((await repo.getDocument(AG1, d.id))?.classification).toBe("public");
      await expect(repo.setDocumentClassification(AG2, d.id, "internal")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("document lists: public-only for the portal, newest-first, tenant-scoped", async () => {
      const pub = await repo.createDocument(docOf({ classification: "public", createdAt: new Date("2026-08-03T00:00:00Z") }));
      const internal = await repo.createDocument(docOf({ createdAt: new Date("2026-08-04T00:00:00Z") }));
      const pubList = await repo.listPublicDocuments(AG1);
      expect(pubList.some((x) => x.id === pub.id)).toBe(true);
      expect(pubList.some((x) => x.id === internal.id)).toBe(false); // internal never leaks
      const all = await repo.listDocuments(AG1);
      expect(all.findIndex((x) => x.id === internal.id)).toBeLessThan(all.findIndex((x) => x.id === pub.id));
      expect((await repo.listDocuments(AG2)).some((x) => x.id === pub.id)).toBe(false);
    });

    // --- the connector upsert (regression: Drizzle dropped blob fields) ------

    it("upsert: INSERT persists blob/extraction fields (2026-08-05 regression)", async () => {
      const src = await repo.createSource({ id: uid(), agencyId: AG1, name: "S1", type: "file_drop", apiKeyHash: null, trust: "review_queue", defaultClassification: "internal" });
      const { document, created } = await repo.upsertDocumentByExternalId(
        docOf({ sourceId: src.id, externalSystemId: "up-1", blobRef: "ag1/up-1", byteSize: 99, mimeType: "text/plain", checksum: "d".repeat(64), extractedText: "body", pageCount: 1 }),
      );
      expect(created).toBe(true);
      const back = await repo.getDocument(AG1, document.id);
      expect(back).toMatchObject({ blobRef: "ag1/up-1", byteSize: 99, checksum: "d".repeat(64), extractedText: "body", pageCount: 1 });
    });

    it("upsert: re-push updates in place; metadata-only re-push preserves stored bytes", async () => {
      const src = await repo.createSource({ id: uid(), agencyId: AG1, name: "S2", type: "file_drop", apiKeyHash: null, trust: "review_queue", defaultClassification: "internal" });
      const first = await repo.upsertDocumentByExternalId(
        docOf({ sourceId: src.id, externalSystemId: "up-2", filename: "v1.pdf", blobRef: "ag1/up-2", byteSize: 10, checksum: "e".repeat(64), extractedText: "v1 text", metadata: { title: "v1" } }),
      );
      // Metadata-only re-push: NO blob keys at all — bytes must survive.
      const second = await repo.upsertDocumentByExternalId(
        docOf({ sourceId: src.id, externalSystemId: "up-2", filename: "v2.pdf", metadata: { title: "v2" } }),
      );
      expect(second.created).toBe(false);
      expect(second.document.id).toBe(first.document.id);
      const back = await repo.getDocument(AG1, first.document.id);
      expect(back?.filename).toBe("v2.pdf");
      expect(back?.metadata).toEqual({ title: "v2" });
      expect(back?.blobRef).toBe("ag1/up-2"); // preserved
      expect(back?.byteSize).toBe(10);
      expect(back?.extractedText).toBe("v1 text");
      // A re-push WITH bytes refreshes them.
      await repo.upsertDocumentByExternalId(
        docOf({ sourceId: src.id, externalSystemId: "up-2", filename: "v3.pdf", blobRef: "ag1/up-2b", byteSize: 20, checksum: "f".repeat(64), extractedText: "v3 text", metadata: { title: "v3" } }),
      );
      const after = await repo.getDocument(AG1, first.document.id);
      expect(after).toMatchObject({ blobRef: "ag1/up-2b", byteSize: 20, extractedText: "v3 text" });
    });

    it("upsert: identity is (sourceId, externalId); null externalId never merges", async () => {
      const srcA = await repo.createSource({ id: uid(), agencyId: AG1, name: "SA", type: "api_push", apiKeyHash: null, trust: "review_queue", defaultClassification: "internal" });
      const srcB = await repo.createSource({ id: uid(), agencyId: AG1, name: "SB", type: "api_push", apiKeyHash: null, trust: "review_queue", defaultClassification: "internal" });
      const a = await repo.upsertDocumentByExternalId(docOf({ sourceId: srcA.id, externalSystemId: "shared-id" }));
      const b = await repo.upsertDocumentByExternalId(docOf({ sourceId: srcB.id, externalSystemId: "shared-id" }));
      expect(b.created).toBe(true); // different source → different doc
      expect(b.document.id).not.toBe(a.document.id);
      const n1 = await repo.upsertDocumentByExternalId(docOf({ sourceId: srcA.id, externalSystemId: null }));
      const n2 = await repo.upsertDocumentByExternalId(docOf({ sourceId: srcA.id, externalSystemId: null }));
      expect(n1.created && n2.created).toBe(true);
      expect(n2.document.id).not.toBe(n1.document.id);
    });

    it("findLatestDocumentByExternalId: newest createdAt wins", async () => {
      const ext = `latest-${uid().slice(0, 8)}`;
      await repo.createDocument(docOf({ externalSystemId: ext, createdAt: new Date("2026-01-01T00:00:00Z"), filename: "old.pdf" }));
      await repo.createDocument(docOf({ externalSystemId: ext, createdAt: new Date("2026-06-01T00:00:00Z"), filename: "new.pdf" }));
      expect((await repo.findLatestDocumentByExternalId(AG1, ext))?.filename).toBe("new.pdf");
      expect(await repo.findLatestDocumentByExternalId(AG2, ext)).toBeNull();
    });

    // --- request attachments -------------------------------------------------

    it("attachments: link is idempotent; attached ids dedupe and stay tenant-scoped", async () => {
      const r = await repo.createRequest(requestOf());
      const d = await repo.createDocument(docOf());
      await repo.linkRequestDocument(AG1, r.id, d.id);
      await repo.linkRequestDocument(AG1, r.id, d.id); // double-link must not duplicate
      expect((await repo.listRequestDocuments(AG1, r.id)).map((x) => x.id)).toEqual([d.id]);
      const attached = await repo.listAttachedDocumentIds(AG1);
      expect(attached.filter((id) => id === d.id)).toHaveLength(1);
      expect((await repo.listAttachedDocumentIds(AG2)).includes(d.id)).toBe(false);
    });

    it("publication states: counts and keyset pages agree with the queue's rules", async () => {
      // Use a THIRD agency so earlier tests' documents can't skew counts.
      const AG3 = uid();
      await repo.createAgency({ id: AG3, slug: `conf-pg-${AG3.slice(0, 8)}`, name: "Pager", stateCode: "CA", observedHolidays: [] });
      const mk = (over: Partial<DocumentEntity>) => repo.createDocument(docOf({ agencyId: AG3, ...over }));

      const d1 = await mk({ createdAt: new Date("2026-08-01T00:00:00Z") }); // undecided (oldest)
      const d2 = await mk({ createdAt: new Date("2026-08-02T00:00:00Z") }); // undecided
      const d3 = await mk({ createdAt: new Date("2026-08-03T00:00:00Z") }); // undecided (newest)
      await mk({ classification: "public", createdAt: new Date("2026-08-04T00:00:00Z") });
      await mk({ metadata: { publicationDecision: { decision: "internal", byUserId: "u", byName: "U", at: "x" } } });
      await mk({ externalSystemId: "redacted:whatever" }); // release artifact — never counted
      const attachedDoc = await mk({ createdAt: new Date("2026-08-05T00:00:00Z") });
      const r = await repo.createRequest(requestOf({ agencyId: AG3 }));
      await repo.linkRequestDocument(AG3, r.id, attachedDoc.id);

      expect(await repo.countPublicationStates(AG3)).toEqual({ undecided: 3, published: 1, kept_internal: 1 });

      // Keyset walk, newest first, two at a time.
      const page1 = await repo.listPublicationDocuments(AG3, "undecided", { limit: 2 });
      expect(page1.map((d) => d.id)).toEqual([d3.id, d2.id]);
      const last = page1[page1.length - 1]!;
      const page2 = await repo.listPublicationDocuments(AG3, "undecided", {
        limit: 2,
        before: { createdAt: last.createdAt, id: last.id },
      });
      expect(page2.map((d) => d.id)).toEqual([d1.id]);
      expect(await repo.countPublicationStates(AG2)).toEqual({ undecided: 0, published: 0, kept_internal: 0 });
    });

    // --- embeddings / chunks -------------------------------------------------

    it("embeddings: public-only listing; body chunks replace on re-set, chunkIndex from 1", async () => {
      const dim = schema.EMBEDDING_DIMENSIONS;
      const vec = (seed: number) => Array.from({ length: dim }, (_, i) => (i === seed ? 1 : 0));
      const pub = await repo.createDocument(docOf({ classification: "public" }));
      const internal = await repo.createDocument(docOf());
      await repo.setDocumentEmbedding(AG1, pub.id, vec(1), "pub");
      await repo.setDocumentEmbedding(AG1, internal.id, vec(2), "int");
      const listed = await repo.listPublicDocumentEmbeddings(AG1);
      expect(listed.some((e) => e.id === pub.id)).toBe(true);
      expect(listed.some((e) => e.id === internal.id)).toBe(false);

      await repo.setDocumentBodyChunks(AG1, internal.id, [
        { content: "c1", embedding: vec(3) },
        { content: "c2", embedding: vec(4) },
      ]);
      await repo.setDocumentBodyChunks(AG1, internal.id, [{ content: "c1-new", embedding: vec(5) }]);
      const chunks = (await repo.listBodyChunkEmbeddings(AG1)).filter((c) => c.documentId === internal.id);
      expect(chunks).toHaveLength(1); // replaced, not appended
      expect(chunks[0]).toMatchObject({ chunkIndex: 1, content: "c1-new" });
      expect(await repo.listDocumentIdsWithBodyChunks(AG1)).toContain(internal.id);
    });

    // --- messages / reviews / releases / deflections -------------------------

    it("messages: thread lists oldest-first, tenant-scoped", async () => {
      const r = await repo.createRequest(requestOf());
      await repo.createMessage({ id: uid(), agencyId: AG1, requestId: r.id, direction: "outbound", channel: "portal", subject: null, body: "later", aiDrafted: false, sentByUserId: USER1, sentAt: new Date("2026-08-02T00:00:00Z"), createdAt: new Date("2026-08-02T00:00:00Z") });
      await repo.createMessage({ id: uid(), agencyId: AG1, requestId: r.id, direction: "inbound", channel: "portal", subject: null, body: "earlier", aiDrafted: false, sentByUserId: null, sentAt: new Date("2026-08-01T00:00:00Z"), createdAt: new Date("2026-08-01T00:00:00Z") });
      expect((await repo.listMessages(AG1, r.id)).map((m) => m.body)).toEqual(["earlier", "later"]);
      expect(await repo.listMessages(AG2, r.id)).toEqual([]);
    });

    it("reviews: one decision per (request, document); re-deciding replaces and returns the STORED row", async () => {
      const r = await repo.createRequest(requestOf());
      const d = await repo.createDocument(docOf());
      const first = await repo.upsertReview({ id: uid(), agencyId: AG1, requestId: r.id, documentId: d.id, decision: "withhold", exemptionLabel: "PII", decidedByUserId: USER1, createdAt: new Date() });
      const second = await repo.upsertReview({ id: uid(), agencyId: AG1, requestId: r.id, documentId: d.id, decision: "release", exemptionLabel: null, decidedByUserId: USER1, createdAt: new Date() });
      // The original row survives a re-decide — the returned id must be the
      // stored one, never the discarded input id.
      expect(second.id).toBe(first.id);
      expect(second.decision).toBe("release");
      const reviews = await repo.listReviews(AG1, r.id);
      expect(reviews).toHaveLength(1);
      expect(reviews[0]?.decision).toBe("release");
      expect(reviews[0]?.id).toBe(first.id);
    });

    it("documents: listDocumentsUnderRetention returns only scheduled or held docs, tenant-scoped", async () => {
      const scheduled = await repo.createDocument(docOf({ retentionUntil: new Date("2026-09-01T00:00:00Z") }));
      const held = await repo.createDocument(docOf({ legalHoldReason: "Litigation hold" }));
      const plain = await repo.createDocument(docOf());
      const under = await repo.listDocumentsUnderRetention(AG1);
      const ids = under.map((d) => d.id);
      expect(ids).toContain(scheduled.id);
      expect(ids).toContain(held.id);
      expect(ids).not.toContain(plain.id);
      const other = await repo.listDocumentsUnderRetention(AG2);
      expect(other.some((d) => d.id === scheduled.id || d.id === held.id)).toBe(false);
    });

    it("reviews: listAgencyReviews spans requests, tenant-scoped", async () => {
      const r1 = await repo.createRequest(requestOf());
      const r2 = await repo.createRequest(requestOf());
      const d1 = await repo.createDocument(docOf());
      const d2 = await repo.createDocument(docOf());
      await repo.upsertReview({ id: uid(), agencyId: AG1, requestId: r1.id, documentId: d1.id, decision: "withhold", exemptionLabel: "Personnel privacy", decidedByUserId: USER1, createdAt: new Date() });
      await repo.upsertReview({ id: uid(), agencyId: AG1, requestId: r2.id, documentId: d2.id, decision: "release_redacted", exemptionLabel: "PII", decidedByUserId: USER1, createdAt: new Date() });
      // The suite shares one repo per adapter — assert containment, not equality.
      const all = await repo.listAgencyReviews(AG1);
      const mine = all.filter((x) => x.requestId === r1.id || x.requestId === r2.id);
      expect(mine.map((x) => x.exemptionLabel).sort()).toEqual(["PII", "Personnel privacy"]);
      const other = await repo.listAgencyReviews(AG2);
      expect(other.some((x) => x.requestId === r1.id || x.requestId === r2.id)).toBe(false);
    });

    it("releases: lookup by id and by contained document, tenant-scoped", async () => {
      const r = await repo.createRequest(requestOf());
      const artifactDocId = uid();
      const release = await repo.createRelease({ id: uid(), agencyId: AG1, requestId: r.id, artifacts: [{ blobRef: "k", filename: "f.pdf", checksum: "cs", documentId: artifactDocId }], responseLetter: "letter", visibility: "public", approvedByUserId: USER1, releasedAt: new Date() });
      expect((await repo.getReleaseById(AG1, release.id))?.responseLetter).toBe("letter");
      expect(await repo.getReleaseById(AG2, release.id)).toBeNull();
      expect((await repo.findReleaseContainingDocument(AG1, artifactDocId))?.id).toBe(release.id);
      expect(await repo.findReleaseContainingDocument(AG2, artifactDocId)).toBeNull();
      expect((await repo.listReleases(AG1, r.id)).map((x) => x.id)).toEqual([release.id]);
    });

    it("releases: agency-wide list, newest first, tenant-scoped", async () => {
      const r1 = await repo.createRequest(requestOf());
      const r2 = await repo.createRequest(requestOf());
      const older = await repo.createRelease({ id: uid(), agencyId: AG1, requestId: r1.id, artifacts: [{ blobRef: "k1", filename: "a.pdf", checksum: "c1" }], responseLetter: null, visibility: "public", approvedByUserId: USER1, releasedAt: new Date("2026-01-01T00:00:00Z") });
      const newer = await repo.createRelease({ id: uid(), agencyId: AG1, requestId: r2.id, artifacts: [{ blobRef: "k2", filename: "b.pdf", checksum: "c2" }], responseLetter: null, visibility: "private", approvedByUserId: USER1, releasedAt: new Date("2026-06-01T00:00:00Z") });
      const all = await repo.listAllReleases(AG1);
      const mine = all.filter((x) => x.id === older.id || x.id === newer.id);
      expect(mine.map((x) => x.id)).toEqual([newer.id, older.id]); // newest first
      expect((await repo.listAllReleases(AG2)).some((x) => x.id === older.id || x.id === newer.id)).toBe(false);
    });

    it("deflections: append + tenant-scoped list", async () => {
      const d = await repo.appendDeflection({ id: uid(), agencyId: AG1, kind: "download", query: "q", documentId: null, estimatedStaffHoursAvoided: 1.5, createdAt: new Date() });
      expect((await repo.listDeflections(AG1)).some((x) => x.id === d.id)).toBe(true);
      expect((await repo.listDeflections(AG2)).some((x) => x.id === d.id)).toBe(false);
    });

    it("plays: full-replace per agency, tenant-scoped list", async () => {
      const mk = (agencyId: string, topic: string, episodes: number) => ({
        id: uid(),
        agencyId,
        topic,
        keywords: topic.split(" "),
        stats: {
          routes: [{ departmentId: null, department: "Public Works", share: 1 }],
          exemptions: [],
          outcomes: { fulfilled: episodes },
          medianDaysToClose: 7,
          extensionRate: 0,
          samplePublicIds: ["PR-1"],
        },
        episodeCount: episodes,
        rebuiltAt: new Date(),
        createdAt: new Date(),
      });

      await repo.replaceAgencyPlays(AG1, [mk(AG1, "towing contracts", 4), mk(AG1, "budget salaries", 2)]);
      await repo.replaceAgencyPlays(AG2, [mk(AG2, "bodycam footage", 3)]);

      const ag1 = await repo.listPlays(AG1);
      expect(ag1.map((p) => p.topic)).toEqual(["towing contracts", "budget salaries"]); // episodeCount desc
      expect(ag1[0]!.stats.routes[0]!.department).toBe("Public Works");
      // Tenant isolation both ways (invariant 2).
      expect((await repo.listPlays(AG2)).map((p) => p.topic)).toEqual(["bodycam footage"]);

      // Full replace: a rebuild with one row leaves exactly one row — and
      // never touches the other agency's plays.
      await repo.replaceAgencyPlays(AG1, [mk(AG1, "towing contracts", 5)]);
      expect((await repo.listPlays(AG1)).map((p) => p.episodeCount)).toEqual([5]);
      expect((await repo.listPlays(AG2)).length).toBe(1);
    });

    it("agent runs: create + get + update + list, all tenant-scoped (§16.2)", async () => {
      const run = await repo.createAgentRun({
        id: uid(),
        agencyId: AG1,
        agentType: "deadline",
        requestId: null,
        status: "awaiting_checkpoint",
        goal: "Nightly deadline sweep",
        plan: {
          goal: "Nightly deadline sweep",
          cursor: 1,
          steps: [
            { index: 0, action: "read_queue", description: "read_queue", status: "done" },
            { index: 1, action: "send_custodian_nudge_email", description: "nudge", status: "awaiting_human" },
          ],
        },
        budgetLimits: { maxToolCalls: 10, maxTokens: 1000, maxWallClockMs: 60_000 },
        budgetSpend: { toolCalls: 1, tokens: 0, wallClockMs: 5 },
        startedByUserId: null,
        handoffNote: null,
        lastStepAt: null,
        createdAt: new Date(),
      });

      expect((await repo.getAgentRun(AG1, run.id))?.status).toBe("awaiting_checkpoint");
      expect(await repo.getAgentRun(AG2, run.id)).toBeNull(); // invariant 2

      const plan = { ...run.plan!, cursor: 2 };
      const updated = await repo.updateAgentRun(AG1, run.id, { status: "completed", plan });
      expect(updated.status).toBe("completed");
      expect(updated.plan?.cursor).toBe(2);
      await expect(repo.updateAgentRun(AG2, run.id, { status: "cancelled" })).rejects.toThrow();

      expect((await repo.listAgentRuns(AG1)).some((r) => r.id === run.id)).toBe(true);
      expect((await repo.listAgentRuns(AG2)).some((r) => r.id === run.id)).toBe(false);
    });

    // --- durable job queue ---------------------------------------------------

    it("jobs: claim → oldest runnable; retry backoff and boot recovery behave alike", async () => {
      const now = new Date("2026-08-05T12:00:00Z");
      const later = new Date("2026-08-05T13:00:00Z");
      const jobBase = { payload: {}, status: "queued" as const, attempts: 0, maxAttempts: 3, lastError: null };
      await repo.createJob({ ...jobBase, id: uid(), kind: "conf_b", runAfter: now, createdAt: new Date("2026-08-05T11:01:00Z") });
      await repo.createJob({ ...jobBase, id: uid(), kind: "conf_a", runAfter: now, createdAt: new Date("2026-08-05T11:00:00Z") });
      await repo.createJob({ ...jobBase, id: uid(), kind: "conf_future", runAfter: later, createdAt: new Date("2026-08-05T10:00:00Z") });

      const first = await repo.claimNextJob(now);
      expect(first?.kind).toBe("conf_a"); // oldest RUNNABLE, not oldest row
      expect(first?.status).toBe("running");
      expect(first?.attempts).toBe(1);

      const second = await repo.claimNextJob(now);
      expect(second?.kind).toBe("conf_b");
      expect(await repo.claimNextJob(now)).toBeNull(); // conf_future not runnable yet

      await repo.completeJob(second!.id, now);
      await repo.retryJob(first!.id, "boom", later);
      expect(await repo.claimNextJob(now)).toBeNull(); // retry respects runAfter
      const retried = await repo.claimNextJob(new Date(later.getTime() + 1));
      expect(retried && ["conf_a", "conf_future"].includes(retried.kind)).toBe(true);
      const retried2 = await repo.claimNextJob(new Date(later.getTime() + 1));
      expect(retried2).not.toBeNull();

      // Simulate a dead worker: running rows go back to queued at boot.
      const recovered = await repo.resetRunningJobs();
      expect(recovered).toBeGreaterThanOrEqual(2);
      const requeued1 = await repo.claimNextJob(new Date(later.getTime() + 1));
      await repo.markJobFailed(requeued1!.id, "terminal", later);
      const failed = await repo.listJobs({ status: "failed" });
      expect(failed.some((j) => j.id === requeued1!.id && j.lastError === "terminal")).toBe(true);
      // Drain so later tests see a quiet queue.
      let j: unknown;
      while ((j = await repo.claimNextJob(new Date("2027-01-01T00:00:00Z")))) {
        await repo.completeJob((j as { id: string }).id, now);
      }
    });

    // --- admin audit / outbox / tokens ---------------------------------------

    it("admin events: newest-first with limit, tenant-scoped", async () => {
      await repo.appendAdminEvent({ id: uid(), agencyId: AG1, kind: "conf_old", actorLabel: "t", summary: "old", createdAt: new Date("2026-08-01T00:00:00Z") });
      await repo.appendAdminEvent({ id: uid(), agencyId: AG1, kind: "conf_new", actorLabel: "t", summary: "new", payload: { p: 1 }, createdAt: new Date("2026-08-02T00:00:00Z") });
      const events = await repo.listAdminEvents(AG1, 50);
      const oldIdx = events.findIndex((e) => e.kind === "conf_old");
      const newIdx = events.findIndex((e) => e.kind === "conf_new");
      expect(newIdx).toBeGreaterThanOrEqual(0);
      expect(newIdx).toBeLessThan(oldIdx);
      expect(events[newIdx]?.payload).toEqual({ p: 1 });
      expect((await repo.listAdminEvents(AG1, 1)).length).toBe(1);
      expect((await repo.listAdminEvents(AG2)).some((e) => e.kind === "conf_old")).toBe(false);
    });

    it("publication decisions: append-only history, newest first, doc filter, tenant-scoped", async () => {
      const docId = uid();
      const base = { agencyId: AG1, documentId: docId, byUserId: USER1, byName: "Conf", reason: null };
      await repo.appendPublicationDecision({ ...base, id: uid(), decision: "published", createdAt: new Date("2026-08-01T00:00:00Z") });
      await repo.appendPublicationDecision({ ...base, id: uid(), decision: "unpublished", reason: "PII", createdAt: new Date("2026-08-02T00:00:00Z") });
      await repo.appendPublicationDecision({ agencyId: AG1, documentId: uid(), id: uid(), decision: "kept_internal", byUserId: USER1, byName: "Conf", reason: null, createdAt: new Date("2026-08-03T00:00:00Z") });

      const forDoc = await repo.listPublicationDecisions(AG1, docId);
      expect(forDoc.map((d) => d.decision)).toEqual(["unpublished", "published"]);
      expect(forDoc[0]?.reason).toBe("PII");
      expect((await repo.listPublicationDecisions(AG1)).length).toBeGreaterThanOrEqual(3);
      expect(await repo.listPublicationDecisions(AG2, docId)).toEqual([]);
    });

    it("deliveries: relay outcomes recorded; failed list is deployment-wide", async () => {
      const del = await repo.createDelivery({ id: uid(), agencyId: AG1, toEmail: "x@y.com", subject: "s", body: "b", kind: "conf_test", requestId: null, taskId: null, createdAt: new Date() });
      await repo.updateDeliveryRelay(del.id, "failed", "smtp 550");
      const failed = await repo.listFailedDeliveries();
      expect(failed.some((d) => d.id === del.id && d.relayError === "smtp 550")).toBe(true);
      const listed = await repo.listDeliveries(AG1);
      expect(listed.find((d) => d.id === del.id)?.relayStatus).toBe("failed");
      expect((await repo.listDeliveries(AG2)).some((d) => d.id === del.id)).toBe(false);
    });

    it("auth tokens: hash lookup + single-use marking", async () => {
      const t = await repo.createAuthToken({ id: uid(), agencyId: AG1, kind: "reset_staff", subjectId: USER1, tokenHash: `conf-hash-${adapterName}`, expiresAt: new Date(Date.now() + 60_000), usedAt: null, createdAt: new Date() });
      expect((await repo.findAuthTokenByHash(t.tokenHash))?.id).toBe(t.id);
      await repo.markAuthTokenUsed(t.id, new Date());
      expect((await repo.findAuthTokenByHash(t.tokenHash))?.usedAt).not.toBeNull();
    });

    // --- sources -------------------------------------------------------------

    it("sources: key hash round-trips through storage; policy patch persists", async () => {
      const s = await repo.createSource({ id: uid(), agencyId: AG1, name: "API", type: "api_push", apiKeyHash: "hash-one", trust: "review_queue", defaultClassification: "internal" });
      // listSources must map the stored credential back to apiKeyHash (the
      // Drizzle adapter stores it as credentialsRef "sha256:<hash>").
      const listed = (await repo.listSources(AG1)).find((x) => x.id === s.id);
      expect(listed).toMatchObject({ apiKeyHash: "hash-one", trust: "review_queue", defaultClassification: "internal", type: "api_push" });
      expect((await repo.listSources(AG2)).some((x) => x.id === s.id)).toBe(false);

      const updated = await repo.updateSource(AG1, s.id, { trust: "auto_publish", defaultClassification: "public" });
      expect(updated).toMatchObject({ trust: "auto_publish", defaultClassification: "public", apiKeyHash: "hash-one" }); // key untouched
      await expect(repo.updateSource(AG2, s.id, { trust: "review_queue" })).rejects.toBeInstanceOf(NotFoundError);
    });

    it("sources: connected-source fields round-trip; delete detaches documents, never removes them", async () => {
      const s = await repo.createSource({
        id: uid(),
        agencyId: AG1,
        name: "Open data",
        type: "scheduled_pull",
        apiKeyHash: null,
        trust: "review_queue",
        defaultClassification: "internal",
        connectorKind: "dataset_file_drop",
        syncSchedule: "nightly",
        mappingConfig: { note: "conf" },
        lastSyncStatus: "never",
      });
      const listed = (await repo.listSources(AG1)).find((x) => x.id === s.id);
      expect(listed).toMatchObject({
        connectorKind: "dataset_file_drop",
        syncSchedule: "nightly",
        mappingConfig: { note: "conf" },
        lastSyncStatus: "never",
      });

      // Sync bookkeeping persists; pausing (syncSchedule: null) is a real write.
      const at = new Date("2026-08-13T06:00:00Z");
      await repo.updateSource(AG1, s.id, { lastSyncAt: at, lastSyncStatus: "ok", lastSyncError: null });
      await repo.updateSource(AG1, s.id, { syncSchedule: null });
      const after = (await repo.listSources(AG1)).find((x) => x.id === s.id);
      expect(after?.lastSyncStatus).toBe("ok");
      expect(after?.lastSyncAt?.getTime()).toBe(at.getTime());
      expect(after?.syncSchedule).toBeNull();

      // Delete: registration goes, the corpus stays (source_id detached).
      const doc = await repo.createDocument(docOf({ sourceId: s.id, externalSystemId: `conf-cs-${adapterName}` }));
      await expect(repo.deleteSource(AG2, s.id)).rejects.toBeInstanceOf(NotFoundError); // tenancy
      await repo.deleteSource(AG1, s.id);
      expect((await repo.listSources(AG1)).some((x) => x.id === s.id)).toBe(false);
      const survivor = await repo.getDocument(AG1, doc.id);
      expect(survivor).not.toBeNull();
      expect(survivor?.sourceId).toBeNull();
    });

    it("sources: key rotation replaces the credential atomically", async () => {
      const s = await repo.createSource({ id: uid(), agencyId: AG1, name: "Rotate", type: "api_push", apiKeyHash: "old-hash", trust: "auto_publish", defaultClassification: "public" });
      await repo.updateSource(AG1, s.id, { apiKeyHash: "new-hash" });
      expect(await repo.findSourceByApiKeyHash(AG1, "old-hash")).toBeNull();
      expect((await repo.findSourceByApiKeyHash(AG1, "new-hash"))?.id).toBe(s.id);
      expect(await repo.findSourceByApiKeyHash(AG2, "new-hash")).toBeNull(); // scoped
    });

    // --- tasks ---------------------------------------------------------------

    it("tasks: round-trip, token lookup, agency-wide list, tenant scoping", async () => {
      const r = await repo.createRequest(requestOf());
      const t = await repo.createTask({ id: uid(), agencyId: AG1, requestId: r.id, departmentId: DEPT1, scopeText: "pull records", status: "assigned", token: `conf-token-${adapterName}`, dueAt: null, uploads: [], pushbackNotes: null });
      expect((await repo.getTaskByToken(t.token))?.id).toBe(t.id);
      expect(await repo.getTask(AG2, t.id)).toBeNull();
      await repo.updateTask(AG1, t.id, { status: "submitted", uploads: [{ name: "a.pdf", pages: 2 }] });
      const back = await repo.getTask(AG1, t.id);
      expect(back?.status).toBe("submitted");
      expect(back?.uploads).toEqual([{ name: "a.pdf", pages: 2 }]);
      expect((await repo.listTasks(AG1, r.id)).map((x) => x.id)).toEqual([t.id]);
      expect((await repo.listAgencyTasks(AG1)).some((x) => x.id === t.id)).toBe(true);
      expect((await repo.listAgencyTasks(AG2)).some((x) => x.id === t.id)).toBe(false);
    });

    // --- directory -----------------------------------------------------------

    it("directory: CRUD round-trip, name-sorted list, tenant-scoped delete", async () => {
      const e = await repo.createDirectoryEntry({ id: uid(), agencyId: AG1, name: "Alpha County", jurisdictionType: "county", contactEmail: "a@county.gov", contactPhone: null, portalUrl: null, recordTypes: ["deeds"], notes: null, peerAgencyId: null });
      await repo.createDirectoryEntry({ id: uid(), agencyId: AG1, name: "Zeta District", jurisdictionType: "special_district", contactEmail: null, contactPhone: null, portalUrl: null, recordTypes: [], notes: null, peerAgencyId: null });
      const names = (await repo.listDirectory(AG1)).map((x) => x.name);
      expect(names.indexOf("Alpha County")).toBeLessThan(names.indexOf("Zeta District"));
      await repo.updateDirectoryEntry(AG1, e.id, { notes: "updated" });
      expect((await repo.getDirectoryEntry(AG1, e.id))?.notes).toBe("updated");
      await repo.deleteDirectoryEntry(AG2, e.id); // cross-tenant delete is a no-op
      expect(await repo.getDirectoryEntry(AG1, e.id)).not.toBeNull();
      await repo.deleteDirectoryEntry(AG1, e.id);
      expect(await repo.getDirectoryEntry(AG1, e.id)).toBeNull();
    });
  });
}

conformance("InMemoryRepository", () => seed(new InMemoryRepository()));

conformance("DrizzleRepository (PGlite)", async () => {
  const pg = new PGlite({ extensions: { vector } });
  const db = drizzle(pg, { schema });
  await migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });
  return seed(new DrizzleRepository(db));
});
