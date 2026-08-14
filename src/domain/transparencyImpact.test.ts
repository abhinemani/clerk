/**
 * Transparency impact: month bucketing keeps archive_miss out of ROI (the
 * house rule), the window is exactly the last N calendar months, the shared
 * signal builder filters junk queries, and projections state checkable
 * arithmetic with no monetized misses (no double counting).
 */
import { describe, expect, it } from "vitest";
import type { DemandPattern } from "./demandPatterns";
import {
  demandSignalsFrom,
  monthlyImpact,
  projectOpportunities,
} from "./transparencyImpact";

const NOW = new Date("2026-08-14T12:00:00Z");

describe("monthlyImpact", () => {
  it("buckets by calendar month and keeps archive_miss out of deflections and hours", () => {
    const rows = monthlyImpact({
      now: NOW,
      requests: [
        { receivedAt: new Date("2026-08-01T00:00:00Z"), createdAt: new Date("2026-08-01T00:00:00Z") },
        { receivedAt: null, createdAt: new Date("2026-07-15T00:00:00Z") }, // falls back to createdAt
        { receivedAt: new Date("2025-01-01T00:00:00Z"), createdAt: new Date("2025-01-01T00:00:00Z") }, // outside window
      ],
      deflections: [
        { kind: "download", estimatedStaffHoursAvoided: 1.5, createdAt: new Date("2026-08-02T00:00:00Z") },
        { kind: "archive_miss", estimatedStaffHoursAvoided: 0, createdAt: new Date("2026-08-03T00:00:00Z") },
      ],
      publishedDocs: [{ createdAt: new Date("2026-07-20T00:00:00Z") }],
    });

    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.month)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
    const aug = rows.at(-1)!;
    expect(aug).toMatchObject({ requests: 1, deflections: 1, archiveMisses: 1, hoursAvoided: 1.5 });
    const jul = rows.at(-2)!;
    expect(jul).toMatchObject({ requests: 1, recordsPublished: 1 });
  });
});

describe("demandSignalsFrom", () => {
  it("labels kinds, prefers interpreted scope, and drops sub-3-char queries", () => {
    const signals = demandSignalsFrom(
      [
        {
          rawText: "raw ask",
          interpretedScope: "interpreted scope",
          receivedAt: new Date("2026-08-01T00:00:00Z"),
          createdAt: new Date("2026-08-01T00:00:00Z"),
          publicId: "PR-2026-00001",
        },
      ],
      [
        { kind: "archive_miss", query: "towing contracts", estimatedStaffHoursAvoided: 0, createdAt: new Date("2026-08-02T00:00:00Z") },
        { kind: "download", query: "ab", estimatedStaffHoursAvoided: 1.5, createdAt: new Date("2026-08-03T00:00:00Z") },
      ],
    );
    expect(signals.map((s) => s.kind)).toEqual(["request", "archive_miss"]);
    expect(signals[0]).toMatchObject({ text: "interpreted scope", ref: "PR-2026-00001" });
  });
});

describe("projectOpportunities", () => {
  const pattern = (over: Partial<DemandPattern>): DemandPattern => ({
    topic: "towing contracts",
    keywords: ["towing", "contracts"],
    total: 7,
    requests: 4,
    queries: 2,
    misses: 1,
    refs: ["PR-2026-00001"],
    lastAt: NOW,
    ...over,
  });

  it("monetizes requests only, at the citation-answer rate, with the math in the basis", () => {
    const [o] = projectOpportunities([pattern({})]);
    expect(o!.projectedHours).toBe(4);
    expect(o!.basis).toContain("4 similar requests");
    expect(o!.basis).toContain("≈ 4 hours");
    expect(o!.basis).toContain("3 searches (1 unanswered)"); // demand cited, never monetized
  });

  it("omits the demand note when there were no searches", () => {
    const [o] = projectOpportunities([pattern({ queries: 0, misses: 0, requests: 1 })]);
    expect(o!.projectedHours).toBe(1);
    expect(o!.basis).not.toContain("signal further demand");
  });
});
