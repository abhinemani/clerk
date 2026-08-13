/** CSV builders — quoting and the annual-report spreadsheet layout. */
import { describe, expect, it } from "vitest";
import { complianceReport } from "./metrics";
import { complianceReportCsv, metricsCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes cells containing commas, quotes, and newlines", () => {
    const out = toCsv([{ a: 'say "hi", ok', b: "one\ntwo" }], ["a", "b"]);
    expect(out).toBe('a,b\n"say ""hi"", ok","one\ntwo"');
  });
});

describe("metricsCsv", () => {
  it("renders metric/value pairs", () => {
    expect(metricsCsv([["total", 3]])).toBe("metric,value\ntotal,3");
  });
});

describe("complianceReportCsv", () => {
  const report = complianceReport(
    [
      {
        receivedAt: new Date("2026-01-05"),
        closedAt: new Date("2026-01-10"),
        statutoryDueAt: new Date("2026-01-15"),
        status: "fulfilled",
        requesterType: "media",
        extended: true,
        exemptionsCited: ["Personnel privacy"],
      },
    ],
    4,
  );

  it("carries every section of the annual report as rows", () => {
    const csv = complianceReportCsv(report, {
      agencyName: "City of Riverton",
      periodLabel: "Through 2026-03-01",
      statuteReview: { reviewedBy: "M. Chen, City Attorney", reviewedOn: "2026-07-01" },
    });
    expect(csv.split("\n")[0]).toBe("section,metric,value");
    expect(csv).toContain("report,agency,City of Riverton");
    expect(csv).toContain("report,period,Through 2026-03-01");
    expect(csv).toContain('report,statute_reviewed_by_counsel,"M. Chen, City Attorney on 2026-07-01"');
    expect(csv).toContain("summary,total_requests,1");
    expect(csv).toContain("summary,extension_usage_rate,1.000");
    expect(csv).toContain("summary,deflections,4");
    expect(csv).toContain("volume_by_month,2026-01,1");
    expect(csv).toContain("volume_by_requester_type,media,1");
    expect(csv).toContain("exemptions_cited,Personnel privacy,1");
  });

  it("says so plainly when counsel has not reviewed the statute config", () => {
    const csv = complianceReportCsv(report, { agencyName: "A", periodLabel: "P" });
    expect(csv).toContain("report,statute_reviewed_by_counsel,not yet reviewed");
  });
});
