/** Annual report narrative rendering — the PDF text before it becomes bytes. */
import { describe, expect, it } from "vitest";
import { complianceReport } from "./metrics";
import { renderComplianceNarrative } from "./annualReport";

describe("renderComplianceNarrative", () => {
  it("includes the agency name, period, and every headline metric", () => {
    const report = complianceReport(
      [
        {
          receivedAt: new Date("2026-01-05"),
          closedAt: new Date("2026-01-10"),
          statutoryDueAt: new Date("2026-01-15"),
          status: "fulfilled",
          requesterType: "media",
          extended: false,
          exemptionsCited: ["Personnel privacy"],
        },
        {
          receivedAt: new Date("2026-02-01"),
          closedAt: null,
          statutoryDueAt: new Date("2026-02-11"),
          status: "in_progress",
          requesterType: "individual",
          extended: true,
          exemptionsCited: [],
        },
      ],
      7,
    );
    const text = renderComplianceNarrative(report, "City of Riverton", "Through 2026-03-01");

    expect(text).toContain("City of Riverton — Public Records Compliance Report");
    expect(text).toContain("Through 2026-03-01");
    // No statuteReview passed → the report is honest about it.
    expect(text).toContain("Statute configuration not yet reviewed by counsel.");
    expect(text).toContain("Total requests:        2");
    expect(text).toContain("Closed:                1");
    expect(text).toContain("Still open:            1");
    expect(text).toContain("Deflections:           7");
    expect(text).toContain("2026-01: 1");
    expect(text).toContain("2026-02: 1");
    expect(text).toContain("media: 1");
    expect(text).toContain("Personnel privacy: 1");
  });

  it("prints the counsel sign-off when one is recorded", () => {
    const report = complianceReport([], 0);
    const text = renderComplianceNarrative(report, "City of Riverton", "Through 2026-03-01", {
      statuteReview: { reviewedBy: "M. Chen, City Attorney", reviewedOn: "2026-07-01" },
    });
    expect(text).toContain("Statute configuration reviewed by counsel: M. Chen, City Attorney, 2026-07-01");
  });

  it("renders honestly with no data — no NaN, no crashes", () => {
    const report = complianceReport([], 0);
    const text = renderComplianceNarrative(report, "City of Riverton", "Through 2026-01-01");
    expect(text).toContain("No closed requests in this period.");
    expect(text).toContain("No requests in this period.");
    expect(text).toContain("None cited in this period.");
    expect(text).not.toMatch(/NaN/);
  });
});
