/**
 * Retention hold service — the anti-spoliation guard. Attaching to an open
 * request holds a document; closing lifts only the holds nothing else needs;
 * a human's hold is never touched by the automation.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository, type Agency, type DocumentEntity, type UserEntity } from "./repository";
import type { ServiceDeps } from "./deps";
import { attachDocumentToRequest } from "./recordsSearchService";
import { holdForOpenRequest, releaseHoldsForClosedRequest, setLegalHold } from "./retentionService";
import { submitRequest } from "./requestService";

const AGENCY: Agency = { id: "ag-1", slug: "riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] };
const ADMIN: UserEntity = { id: "u-dana", agencyId: "ag-1", email: "dana@riverton.gov", name: "Dana", role: "admin", passwordHash: null };

const doc = (over: Partial<DocumentEntity>): DocumentEntity => ({
  id: "d-1",
  agencyId: "ag-1",
  sourceId: null,
  externalSystemId: null,
  filename: "record.pdf",
  classification: "internal",
  recordType: null,
  processingStatus: "ready",
  metadata: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

function ctx() {
  const repo = new InMemoryRepository().seedAgency(AGENCY);
  let n = 0;
  const deps: ServiceDeps = {
    repo,
    now: () => new Date("2026-08-04T12:00:00Z"),
    genId: () => `id-${++n}`,
    genToken: () => `tok-${n}`,
  };
  return { repo, deps };
}

describe("holdForOpenRequest", () => {
  it("holds a document attached to an open request, naming the request", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1" }));
    await holdForOpenRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "d-1" });
    const held = await repo.getDocument("ag-1", "d-1");
    expect(held?.legalHoldReason).toBe(`Responsive to open request ${r.publicId}`);
  });

  it("never overwrites an existing (possibly human) hold", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1", legalHoldReason: "Litigation — Smith v. City" }));
    await holdForOpenRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "d-1" });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason).toBe("Litigation — Smith v. City");
  });

  it("does nothing for a request that is already closed", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.updateRequest("ag-1", r.id, { closedAt: deps.now() });
    await repo.createDocument(doc({ id: "d-1" }));
    await holdForOpenRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "d-1" });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason ?? null).toBeNull();
  });

  it("rides along with attach-from-search — the path staff actually use", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1" }));
    await attachDocumentToRequest(deps, {
      agencyId: "ag-1",
      requestId: r.id,
      documentId: "d-1",
      actorUserId: "u-dana",
    });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason).toContain("Responsive to open request");
  });
});

describe("releaseHoldsForClosedRequest", () => {
  it("lifts the auto hold when no other open request needs the document", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1" }));
    await repo.linkRequestDocument("ag-1", r.id, "d-1");
    await holdForOpenRequest(deps, { agencyId: "ag-1", requestId: r.id, documentId: "d-1" });

    await repo.updateRequest("ag-1", r.id, { closedAt: deps.now() });
    const out = await releaseHoldsForClosedRequest(deps, { agencyId: "ag-1", requestId: r.id });
    expect(out).toEqual({ cleared: 1, kept: 0 });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason ?? null).toBeNull();
  });

  it("KEEPS the hold when another open request still needs the document, re-pointing it", async () => {
    const { repo, deps } = ctx();
    const closing = await submitRequest(deps, { agencyId: "ag-1", rawText: "first" });
    const other = await submitRequest(deps, { agencyId: "ag-1", rawText: "second" });
    await repo.createDocument(doc({ id: "d-1" }));
    await repo.linkRequestDocument("ag-1", closing.id, "d-1");
    await repo.linkRequestDocument("ag-1", other.id, "d-1");
    await holdForOpenRequest(deps, { agencyId: "ag-1", requestId: closing.id, documentId: "d-1" });

    await repo.updateRequest("ag-1", closing.id, { closedAt: deps.now() });
    const out = await releaseHoldsForClosedRequest(deps, { agencyId: "ag-1", requestId: closing.id });
    expect(out).toEqual({ cleared: 0, kept: 1 });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason).toBe(
      `Responsive to open request ${other.publicId}`,
    );
  });

  it("leaves a human's litigation hold alone", async () => {
    const { repo, deps } = ctx();
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1", legalHoldReason: "Litigation — Smith v. City" }));
    await repo.linkRequestDocument("ag-1", r.id, "d-1");
    await repo.updateRequest("ag-1", r.id, { closedAt: deps.now() });

    const out = await releaseHoldsForClosedRequest(deps, { agencyId: "ag-1", requestId: r.id });
    expect(out).toEqual({ cleared: 0, kept: 0 });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason).toBe("Litigation — Smith v. City");
  });
});

describe("setLegalHold", () => {
  it("records who placed and who lifted a hold on the request trail", async () => {
    const { repo, deps } = ctx();
    await repo.createUser(ADMIN);
    const r = await submitRequest(deps, { agencyId: "ag-1", rawText: "records" });
    await repo.createDocument(doc({ id: "d-1", filename: "incident.pdf" }));

    await setLegalHold(deps, {
      agencyId: "ag-1",
      documentId: "d-1",
      reason: "Litigation — Smith v. City",
      actorUserId: "u-dana",
      requestId: r.id,
    });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason).toBe("Litigation — Smith v. City");

    await setLegalHold(deps, {
      agencyId: "ag-1",
      documentId: "d-1",
      reason: null,
      actorUserId: "u-dana",
      requestId: r.id,
    });
    expect((await repo.getDocument("ag-1", "d-1"))?.legalHoldReason ?? null).toBeNull();

    const events = await repo.listEvents("ag-1", r.id);
    const holdEvents = events.filter((e) => e.payload?.source === "retention");
    expect(holdEvents).toHaveLength(2);
    expect(holdEvents[0]!.summary).toContain("Dana placed a legal hold on incident.pdf");
    expect(holdEvents[1]!.summary).toContain("Dana lifted the legal hold");
    expect(holdEvents.every((e) => e.actorUserId === "u-dana")).toBe(true);
  });
});
