import { describe, expect, it } from "vitest";
import type { DocumentEntity, ReleaseEntity, RequestEntity, ReviewEntity } from "@/services/repository";
import {
  buildProductionIndex,
  compileExemptionLog,
  renderProductionIndexText,
} from "./productionIndex";

const NOW = new Date("2026-08-14T12:00:00Z");

function fixtureRequest(): RequestEntity {
  return {
    id: "req-1",
    agencyId: "ag-1",
    publicId: "PR-2026-00042",
    requesterId: null,
    rawText: "All towing contracts with vendors since 2024",
    interpretedScope: "Towing contracts, 2024–present",
    recordTypes: ["contracts"],
    complexityScore: null,
    status: "partially_fulfilled",
    receivedAt: new Date("2026-06-01T09:00:00Z"),
    statutoryDueAt: new Date("2026-06-15T00:00:00Z"),
    extensionHistory: [],
    closedAt: null,
    createdAt: new Date("2026-06-01T09:00:00Z"),
  } as RequestEntity;
}

const doc = (over: Partial<DocumentEntity>): DocumentEntity =>
  ({
    id: "d1",
    agencyId: "ag-1",
    sourceId: null,
    externalSystemId: null,
    filename: "towing-contract-2024.pdf",
    classification: "internal",
    recordType: "contract",
    processingStatus: "ready",
    metadata: null,
    createdAt: new Date("2026-06-02T00:00:00Z"),
    ...over,
  }) as DocumentEntity;

const review = (over: Partial<ReviewEntity>): ReviewEntity => ({
  id: "rev-1",
  agencyId: "ag-1",
  requestId: "req-1",
  documentId: "d1",
  decision: "release",
  exemptionLabel: null,
  decidedByUserId: "u-dana",
  createdAt: new Date("2026-06-20T00:00:00Z"),
  ...over,
});

describe("compileExemptionLog", () => {
  it("groups citations deterministically: count desc, then label asc; docs de-duplicated", () => {
    const log = compileExemptionLog([
      { document: "a.pdf", exemption: "Privacy" },
      { document: "a.pdf", exemption: "Privacy" },
      { document: "b.pdf", exemption: "Privacy" },
      { document: "b.pdf", exemption: "Investigation" },
      { document: "c.pdf", exemption: "Deliberative" },
    ]);
    expect(log.map((e) => e.exemption)).toEqual(["Privacy", "Deliberative", "Investigation"]);
    expect(log[0]).toEqual({ exemption: "Privacy", count: 3, documents: ["a.pdf", "b.pdf"] });
  });
});

describe("buildProductionIndex", () => {
  it("indexes each source document with decision, exemption, decider, redactions, and release", () => {
    const redactedArtifact = doc({
      id: "d2-redacted",
      externalSystemId: "redacted:d2",
      filename: "invoice-2024_redacted.pdf",
      metadata: {
        redactionOf: "d2",
        exemptionLog: [
          { line: 3, startCol: 0, endCol: 12, reason: "Privacy (Gov 6254(c))" },
          { line: 9, startCol: 4, endCol: 20, reason: "Privacy (Gov 6254(c))" },
        ],
      },
    });
    const releases: ReleaseEntity[] = [
      {
        id: "rel-1",
        agencyId: "ag-1",
        requestId: "req-1",
        artifacts: [
          { blobRef: "b1", filename: "towing-contract-2024.pdf", checksum: "abc123", documentId: "d1" },
          { blobRef: "b2", filename: "invoice-2024_redacted.pdf", checksum: "def456", documentId: "d2-redacted" },
        ],
        responseLetter: null,
        visibility: "public",
        approvedByUserId: "u-dana",
        releasedAt: new Date("2026-06-25T10:00:00Z"),
      },
    ];

    const index = buildProductionIndex({
      agencyName: "City of Riverton",
      request: fixtureRequest(),
      reviews: [
        review({}),
        review({ id: "rev-2", documentId: "d2", decision: "release_redacted", exemptionLabel: "Privacy (Gov 6254(c))" }),
        review({ id: "rev-3", documentId: "d3", decision: "withhold", exemptionLabel: "Attorney-client" }),
      ],
      documents: [
        doc({}),
        doc({ id: "d2", filename: "invoice-2024.pdf", recordType: "invoice" }),
        doc({ id: "d3", filename: "counsel-memo.pdf", recordType: "memo" }),
        doc({ id: "d4", filename: "undecided.pdf" }),
      ],
      redactionArtifacts: [redactedArtifact],
      releases,
      actorNameById: new Map([["u-dana", "Dana Whitfield"]]),
      now: NOW,
    });

    expect(index.summary).toEqual({ documents: 4, released: 1, redacted: 1, withheld: 1, undecided: 1 });

    const byName = new Map(index.rows.map((r) => [r.document, r]));
    expect(byName.get("towing-contract-2024.pdf")).toMatchObject({
      decision: "release",
      decidedBy: "Dana Whitfield",
      release: "Released 2026-06-25 · sha256:abc123",
    });
    // The redacted doc resolves its release THROUGH its redacted artifact and
    // carries the artifact's distinct redaction reasons.
    expect(byName.get("invoice-2024.pdf")).toMatchObject({
      decision: "release_redacted",
      exemption: "Privacy (Gov 6254(c))",
      redactionReasons: ["Privacy (Gov 6254(c))"],
      release: "Released 2026-06-25 · sha256:def456",
    });
    expect(byName.get("counsel-memo.pdf")).toMatchObject({ decision: "withhold", release: null });
    expect(byName.get("undecided.pdf")).toMatchObject({ decision: "undecided", decidedBy: null });

    // The exemption log aggregates only decided restrictions.
    expect(index.exemptionLog.map((e) => e.exemption).sort()).toEqual([
      "Attorney-client",
      "Privacy (Gov 6254(c))",
    ]);
  });

  it("excludes redacted artifacts from the index rows (release copies, not records)", () => {
    const index = buildProductionIndex({
      agencyName: "City of Riverton",
      request: fixtureRequest(),
      reviews: [],
      documents: [doc({}), doc({ id: "dr", externalSystemId: "redacted:d1", filename: "x_redacted.pdf" })],
      redactionArtifacts: [],
      releases: [],
      actorNameById: new Map(),
      now: NOW,
    });
    expect(index.rows.map((r) => r.document)).toEqual(["towing-contract-2024.pdf"]);
  });

  it("the latest review per document wins for display", () => {
    const index = buildProductionIndex({
      agencyName: "City of Riverton",
      request: fixtureRequest(),
      reviews: [
        review({ decision: "withhold", exemptionLabel: "Privacy", createdAt: new Date("2026-06-10T00:00:00Z") }),
        review({ id: "rev-2", decision: "release", createdAt: new Date("2026-06-22T00:00:00Z") }),
      ],
      documents: [doc({})],
      redactionArtifacts: [],
      releases: [],
      now: NOW,
    });
    expect(index.rows[0]!.decision).toBe("release");
  });

  it("renders the index as export text with the immutable ask and both sections", () => {
    const text = renderProductionIndexText(
      buildProductionIndex({
        agencyName: "City of Riverton",
        request: fixtureRequest(),
        reviews: [review({ decision: "withhold", exemptionLabel: "Attorney-client" })],
        documents: [doc({})],
        redactionArtifacts: [],
        releases: [],
        actorNameById: new Map([["u-dana", "Dana Whitfield"]]),
        now: NOW,
      }),
    );
    expect(text).toContain("Production index — PR-2026-00042 · City of Riverton");
    expect(text).toContain('As filed (immutable, invariant 6): "All towing contracts with vendors since 2024"');
    expect(text).toContain("I. INDEX OF RECORDS");
    expect(text).toContain("Decision: Withheld — Attorney-client (by Dana Whitfield)");
    expect(text).toContain("II. EXEMPTION LOG");
    expect(text).toContain("Attorney-client — cited 1 time(s): towing-contract-2024.pdf");
  });
});
