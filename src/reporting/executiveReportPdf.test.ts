/** Tests for the executive report PDF renderer (docs/executive-reporting.md). */
import { describe, expect, it } from "vitest";
import { computeExecutiveSummary, type ExecutiveDataset } from "./executiveSummary";
import { ALL_SECTION_IDS, renderExecutiveReportPdf } from "./executiveReportPdf";

const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const REF = new Date("2026-08-14T12:00:00Z");

function summaryOf(dataset: Partial<ExecutiveDataset> = {}) {
  return computeExecutiveSummary({ requests: [], tasks: [], deflections: [], ...dataset }, "week", REF);
}

const baseOpts = {
  agencyName: "City of Riverton",
  sections: ALL_SECTION_IDS,
  generatedAt: new Date("2026-08-15T08:00:00Z"),
  preparedBy: "Dana Okafor",
};

const latin1 = (buf: Buffer) => buf.toString("latin1");

describe("renderExecutiveReportPdf", () => {
  it("renders a full report: masthead, all sections, footer, provenance line", () => {
    const s = latin1(
      renderExecutiveReportPdf(
        summaryOf({
          requests: [
            {
              publicId: "PR-2026-00001",
              receivedAt: d("2026-08-11"),
              closedAt: d("2026-08-13"),
              status: "fulfilled",
              statutoryDueAt: d("2026-08-20"),
              extensionDates: [],
              referredAt: null,
              exemptionsCited: ["Personnel records"],
            },
          ],
          tasks: [{ departmentName: "Public Works", createdAt: d("2026-08-11"), status: "done" }],
          deflections: [{ kind: "download", createdAt: d("2026-08-12"), hoursAvoided: 1.5 }],
        }),
        baseOpts,
      ),
    );
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s).toContain("City of Riverton");
    expect(s).toContain("EXECUTIVE REPORT");
    expect(s).toContain("HEADLINE NUMBERS");
    expect(s).toContain("VOLUME TREND");
    expect(s).toContain("DEADLINE PERFORMANCE");
    expect(s).toContain("OUTCOMES & EXEMPTIONS");
    expect(s).toContain("DEPARTMENT ACTIVITY");
    expect(s).toContain("TRANSPARENCY IMPACT");
    expect(s).toContain("Public Works");
    expect(s).toContain("Personnel records");
    expect(s).toContain("Prepared by Dana Okafor");
    expect(s).toContain("Page 1 of");
    expect(s).toContain("Computed from the live request record");
  });

  it("renders only the chosen sections", () => {
    const s = latin1(renderExecutiveReportPdf(summaryOf(), { ...baseOpts, sections: ["kpis", "impact"] }));
    expect(s).toContain("HEADLINE NUMBERS");
    expect(s).toContain("TRANSPARENCY IMPACT");
    expect(s).not.toContain("VOLUME TREND");
    expect(s).not.toContain("DEPARTMENT ACTIVITY");
  });

  it("prints honest empty states for a quiet period instead of suppressing sections", () => {
    const s = latin1(renderExecutiveReportPdf(summaryOf(), baseOpts));
    expect(s).toContain("No requests with a computed deadline were closed in this period.");
    expect(s).toContain("No tasks were dispatched to departments in this period.");
    expect(s).toContain("No exemptions were cited on requests closed this period");
  });

  it("carries the statute-review honesty line both ways", () => {
    const without = latin1(renderExecutiveReportPdf(summaryOf(), baseOpts));
    expect(without).toContain("not yet reviewed by counsel");
    const withReview = latin1(
      renderExecutiveReportPdf(summaryOf(), {
        ...baseOpts,
        statuteReview: { reviewedBy: "County Counsel", reviewedOn: "2026-05-01" },
      }),
    );
    expect(withReview).toContain("reviewed by counsel: County Counsel, 2026-05-01");
  });

  it("prints the clerk's framing note when present", () => {
    const s = latin1(renderExecutiveReportPdf(summaryOf(), { ...baseOpts, note: "Prepared for the August council meeting." }));
    expect(s).toContain("Prepared for the August council meeting.");
  });
});
