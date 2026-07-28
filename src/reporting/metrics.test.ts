/** Tests for compliance reporting metrics (spec §11). */
import { describe, expect, it } from "vitest";
import {
  complianceReport,
  daysToClose,
  exemptionFrequency,
  extensionUsageRate,
  onTimeRate,
  percentile,
  volumeByMonth,
  type RequestForMetrics,
} from "./metrics";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);

function rec(over: Partial<RequestForMetrics>): RequestForMetrics {
  return {
    receivedAt: d("2026-01-05"),
    closedAt: null,
    statutoryDueAt: d("2026-01-15"),
    status: "closed",
    requesterType: "individual",
    extended: false,
    exemptionsCited: [],
    ...over,
  };
}

describe("percentile", () => {
  it("interpolates and handles edges", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 5);
  });
});

describe("onTimeRate", () => {
  it("counts closed-on-or-before-due over closed requests", () => {
    const records = [
      rec({ closedAt: d("2026-01-10") }), // on time
      rec({ closedAt: d("2026-01-20") }), // late
      rec({ closedAt: null }), // still open — excluded
    ];
    expect(onTimeRate(records)).toBe(0.5);
  });

  it("is 1 when nothing is closed yet", () => {
    expect(onTimeRate([rec({ closedAt: null })])).toBe(1);
  });
});

describe("daysToClose", () => {
  it("computes median, p90, mean over closed requests", () => {
    const records = [
      rec({ receivedAt: d("2026-01-01"), closedAt: d("2026-01-06") }), // 5
      rec({ receivedAt: d("2026-01-01"), closedAt: d("2026-01-11") }), // 10
      rec({ receivedAt: d("2026-01-01"), closedAt: d("2026-01-21") }), // 20
    ];
    const r = daysToClose(records);
    expect(r.count).toBe(3);
    expect(r.median).toBe(10);
    expect(r.mean).toBe(12); // (5+10+20)/3 = 11.67 → 12
  });
});

describe("volume + rates", () => {
  it("buckets volume by received month", () => {
    const v = volumeByMonth([rec({ receivedAt: d("2026-01-05") }), rec({ receivedAt: d("2026-02-02") }), rec({ receivedAt: d("2026-01-30") })]);
    expect(v["2026-01"]).toBe(2);
    expect(v["2026-02"]).toBe(1);
  });

  it("computes extension usage rate", () => {
    expect(extensionUsageRate([rec({ extended: true }), rec({ extended: false }), rec({ extended: false })])).toBeCloseTo(1 / 3, 5);
  });

  it("ranks exemption frequency most-cited first", () => {
    const freq = exemptionFrequency([
      rec({ exemptionsCited: ["Personal privacy", "Law enforcement"] }),
      rec({ exemptionsCited: ["Personal privacy"] }),
    ]);
    expect(freq[0]).toEqual({ label: "Personal privacy", count: 2 });
    expect(freq[1]).toEqual({ label: "Law enforcement", count: 1 });
  });
});

describe("complianceReport", () => {
  it("assembles the full metric set", () => {
    const records = [
      rec({ closedAt: d("2026-01-10"), requesterType: "media", exemptionsCited: ["Personal privacy"] }),
      rec({ closedAt: null, requesterType: "legal" }),
    ];
    const report = complianceReport(records, 41);
    expect(report.total).toBe(2);
    expect(report.closed).toBe(1);
    expect(report.open).toBe(1);
    expect(report.deflections).toBe(41);
    expect(report.volumeByRequesterType.media).toBe(1);
    expect(report.exemptionFrequency[0]!.label).toBe("Personal privacy");
  });
});
