/** Tests for proactive-publication recommendations (spec §6.7). */
import { describe, expect, it } from "vitest";
import { proactivePublicationReport } from "./proactivePublication";

describe("proactivePublicationReport", () => {
  const requests = [
    { recordTypes: ["minutes"] },
    { recordTypes: ["minutes"] },
    { recordTypes: ["minutes"] },
    { recordTypes: ["contracts", "minutes"] },
    { recordTypes: ["permits"] },
  ];

  it("recommends record types requested at least minCount times, most-requested first", () => {
    const recs = proactivePublicationReport(requests, { minCount: 3 });
    expect(recs[0]!.recordType).toBe("minutes");
    expect(recs[0]!.requestCount).toBe(4);
    expect(recs[0]!.recommendation).toContain("publishing");
    // contracts (1) and permits (1) fall below the threshold.
    expect(recs.map((r) => r.recordType)).not.toContain("permits");
  });

  it("returns nothing when nothing is repeatedly requested", () => {
    expect(proactivePublicationReport([{ recordTypes: ["a"] }, { recordTypes: ["b"] }], { minCount: 3 })).toEqual([]);
  });
});
