/**
 * Live compliance dataset — the seam between the repository and §11 metrics.
 * These pin the two fields that used to be hardcoded lies (`extended: false`,
 * `exemptionsCited: []`): extensions come from the request's own
 * extensionHistory, citations from review decisions plus denial events.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRepository } from "@/services/repository";
import { liveComplianceDataset } from "./reportingData";

const AG = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "bbbbbbbb-0000-4000-8000-000000000001";
const uid = () => crypto.randomUUID();

async function agencyRepo(): Promise<InMemoryRepository> {
  const repo = new InMemoryRepository();
  await repo.createAgency({ id: AG, slug: "rpt-riverton", name: "Riverton", stateCode: "CA", observedHolidays: [] });
  await repo.createUser({ id: USER, agencyId: AG, email: "rpt@riverton.gov", name: "Rpt", role: "coordinator", passwordHash: null });
  return repo;
}

function requestOf(over: Partial<import("@/services/repository").RequestEntity> = {}) {
  return {
    id: uid(),
    agencyId: AG,
    publicId: `PR-2026-${Math.floor(Math.random() * 90000) + 10000}`,
    requesterId: null,
    status: "in_review" as const,
    rawText: "reporting",
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: new Date("2026-03-01T00:00:00Z"),
    statutoryDueAt: null,
    closedAt: null,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...over,
  };
}

describe("liveComplianceDataset", () => {
  it("reads extension usage from the request's extensionHistory", async () => {
    const repo = await agencyRepo();
    const extended = await repo.createRequest(requestOf());
    await repo.updateRequest(AG, extended.id, {
      extensionHistory: [{ at: "2026-03-10T00:00:00Z", byUserId: USER, days: 10, reason: "voluminous" }],
    });
    await repo.createRequest(requestOf());

    const { records } = await liveComplianceDataset(AG, repo);
    expect(records.filter((r) => r.extended)).toHaveLength(1);
  });

  it("counts an exemption once per request from review decisions, released docs cite nothing", async () => {
    const repo = await agencyRepo();
    const r = await repo.createRequest(requestOf());
    const mk = () => ({
      id: uid(),
      agencyId: AG,
      sourceId: null,
      externalSystemId: null,
      filename: "doc.pdf",
      classification: "internal" as const,
      recordType: null,
      processingStatus: "ready" as const,
      metadata: {},
      createdAt: new Date("2026-03-02T00:00:00Z"),
    });
    const [d1, d2, d3] = await Promise.all([repo.createDocument(mk()), repo.createDocument(mk()), repo.createDocument(mk())]);
    // Two withheld docs under the SAME label = one citation for the request.
    await repo.upsertReview({ id: uid(), agencyId: AG, requestId: r.id, documentId: d1!.id, decision: "withhold", exemptionLabel: "Personnel privacy", decidedByUserId: USER, createdAt: new Date() });
    await repo.upsertReview({ id: uid(), agencyId: AG, requestId: r.id, documentId: d2!.id, decision: "withhold", exemptionLabel: "Personnel privacy", decidedByUserId: USER, createdAt: new Date() });
    await repo.upsertReview({ id: uid(), agencyId: AG, requestId: r.id, documentId: d3!.id, decision: "release", exemptionLabel: null, decidedByUserId: USER, createdAt: new Date() });

    const { records } = await liveComplianceDataset(AG, repo);
    expect(records[0]!.exemptionsCited).toEqual(["Personnel privacy"]);
  });

  it("picks up denial citations from the status_change event, merged with review labels", async () => {
    const repo = await agencyRepo();
    const r = await repo.createRequest(requestOf({ status: "denied", closedAt: new Date("2026-03-20T00:00:00Z") }));
    await repo.appendEvent({
      id: uid(),
      agencyId: AG,
      requestId: r.id,
      kind: "status_change",
      actorUserId: USER,
      summary: "Status in_review → denied",
      payload: { from: "in_review", to: "denied", exemptions: ["Gov. Code § 6254(f)"] },
      createdAt: new Date("2026-03-20T00:00:00Z"),
    });

    const { records } = await liveComplianceDataset(AG, repo);
    expect(records[0]!.exemptionsCited).toEqual(["Gov. Code § 6254(f)"]);
  });
});
