/** Tests for the B2 consistency-audit domain logic (pure, deterministic). */
import { describe, expect, it } from "vitest";
import {
  decisionRecordsFrom,
  findInconsistencies,
  type DecisionRecord,
} from "./consistencyAudit";

const d = (over: Partial<DecisionRecord>): DecisionRecord => ({
  requestPublicId: "PR-2026-00001",
  documentId: "doc-1",
  documentName: "report.pdf",
  recordType: "police report",
  decision: "release",
  exemptionLabel: null,
  decidedAt: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

describe("findInconsistencies", () => {
  it("flags a record type released in full in one request but withheld in another", () => {
    const findings = findInconsistencies([
      d({ requestPublicId: "PR-2026-00131", decision: "release" }),
      d({
        requestPublicId: "PR-2026-00104",
        documentId: "doc-2",
        documentName: "report-2.pdf",
        decision: "withhold",
        exemptionLabel: "Privacy (Gov 6254(c))",
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("divergent_decision");
    expect(findings[0]!.releasedIn).toEqual(["PR-2026-00131"]);
    expect(findings[0]!.restrictedIn).toEqual(["PR-2026-00104"]);
    expect(findings[0]!.summary).toContain("police report");
    expect(findings[0]!.summary).toContain("Privacy (Gov 6254(c))");
  });

  it("flags the same record type restricted under different exemptions across requests", () => {
    const findings = findInconsistencies([
      d({
        requestPublicId: "PR-2026-00104",
        decision: "release_redacted",
        exemptionLabel: "Privacy (Gov 6254(c))",
      }),
      d({
        requestPublicId: "PR-2026-00150",
        documentId: "doc-2",
        decision: "release_redacted",
        exemptionLabel: "Investigation (Gov 6254(f))",
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.kind).toBe("divergent_exemption");
    expect(findings[0]!.exemptions).toEqual([
      "Investigation (Gov 6254(f))",
      "Privacy (Gov 6254(c))",
    ]);
  });

  it("does NOT flag divergence inside a single request (per-document review is normal)", () => {
    expect(
      findInconsistencies([
        d({ decision: "release" }),
        d({ documentId: "doc-2", decision: "withhold", exemptionLabel: "Privacy" }),
        // A second request exists but treats the type uniformly.
        d({ requestPublicId: "PR-2026-00002", documentId: "doc-3", decision: "withhold", exemptionLabel: "Privacy" }),
      ]),
    ).toEqual([]);
  });

  it("does NOT flag consistent treatment, same-label case variants, or untyped documents", () => {
    expect(
      findInconsistencies([
        // Same label, different casing — one exemption, not two.
        d({ requestPublicId: "PR-1", decision: "withhold", exemptionLabel: "privacy" }),
        d({ requestPublicId: "PR-2", documentId: "doc-2", decision: "withhold", exemptionLabel: "Privacy" }),
        // Untyped docs are skipped: nothing to compare.
        d({ requestPublicId: "PR-1", documentId: "doc-3", recordType: null, decision: "release" }),
        d({ requestPublicId: "PR-2", documentId: "doc-4", recordType: "  ", decision: "withhold" }),
      ]),
    ).toEqual([]);
  });

  it("requires at least two distinct requests per record type", () => {
    expect(
      findInconsistencies([
        d({ decision: "release" }),
        d({ documentId: "doc-2", decision: "withhold", exemptionLabel: "Privacy" }),
      ]),
    ).toEqual([]);
  });

  it("is deterministic: findings sort by record type, exemplars are capped", () => {
    const many: DecisionRecord[] = [];
    for (let i = 0; i < 10; i++) {
      many.push(
        d({ requestPublicId: "PR-A", documentId: `rel-${i}`, recordType: "zoning email", decision: "release" }),
        d({ requestPublicId: "PR-B", documentId: `wh-${i}`, recordType: "zoning email", decision: "withhold", exemptionLabel: "Deliberative" }),
      );
    }
    many.push(
      d({ requestPublicId: "PR-C", recordType: "arrest log", decision: "release" }),
      d({ requestPublicId: "PR-D", documentId: "doc-x", recordType: "arrest log", decision: "withhold", exemptionLabel: "Juvenile" }),
    );
    const findings = findInconsistencies(many);
    expect(findings.map((f) => f.recordType)).toEqual(["arrest log", "zoning email"]);
    for (const f of findings) expect(f.exemplars.length).toBeLessThanOrEqual(6);
  });
});

describe("decisionRecordsFrom", () => {
  it("joins reviews with request publicIds and document names/types; drops orphans", () => {
    const records = decisionRecordsFrom(
      [{ id: "r1", publicId: "PR-2026-00104" }],
      [
        { requestId: "r1", documentId: "d1", decision: "withhold", exemptionLabel: "Privacy", createdAt: new Date() },
        { requestId: "r-gone", documentId: "d1", decision: "release", exemptionLabel: null, createdAt: new Date() },
      ],
      [{ id: "d1", filename: "ia-file.pdf", recordType: "personnel file" }],
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      requestPublicId: "PR-2026-00104",
      documentName: "ia-file.pdf",
      recordType: "personnel file",
      decision: "withhold",
    });
  });
});
