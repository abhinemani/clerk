/** Transparency log: the no-PII projection is the load-bearing part. */
import { describe, expect, it } from "vitest";
import type { RequestEntity } from "@/services/repository";
import { publicLogSummary, toPublicLogEntry } from "./transparencyLog";

function req(over: Partial<RequestEntity>): RequestEntity {
  return {
    id: "r-1",
    agencyId: "ag-1",
    publicId: "PR-2026-00001",
    requesterId: "req-secret-id",
    status: "submitted",
    rawText: "I want MY OWN medical records; I live at 88 Larkspur Lane and my SSN is 000-12-3456.",
    interpretedScope: null,
    recordTypes: [],
    complexityScore: null,
    receivedAt: new Date("2026-08-01T10:00:00Z"),
    statutoryDueAt: new Date("2026-08-15T10:00:00Z"),
    closedAt: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    ...over,
  };
}

describe("toPublicLogEntry", () => {
  it("NEVER leaks the raw filing text or any requester field", () => {
    const entry = toPublicLogEntry(req({}));
    const flat = JSON.stringify(entry);
    expect(flat).not.toContain("Larkspur"); // raw text stays private
    expect(flat).not.toContain("000-12-3456");
    expect(flat).not.toContain("req-secret-id"); // no requester linkage
    expect(entry.subject).toBe("Awaiting review"); // placeholder pre-triage
    // The entry carries exactly the public fields, nothing else.
    expect(Object.keys(entry).sort()).toEqual([
      "closedOn", "onTime", "publicId", "receivedOn", "statusLabel", "subject",
    ]);
  });

  it("uses the staff-curated scope once triage set it, with honest timing", () => {
    const entry = toPublicLogEntry(
      req({
        interpretedScope: "Sidewalk repair invoices for Oak Avenue, 2025.",
        status: "fulfilled",
        closedAt: new Date("2026-08-10T10:00:00Z"),
      }),
    );
    expect(entry.subject).toBe("Sidewalk repair invoices for Oak Avenue, 2025.");
    expect(entry.statusLabel).toBeTruthy();
    expect(entry.closedOn).toBe("2026-08-10");
    expect(entry.onTime).toBe(true);

    const late = toPublicLogEntry(
      req({ closedAt: new Date("2026-09-01T10:00:00Z"), status: "fulfilled" }),
    );
    expect(late.onTime).toBe(false);
  });
});

describe("publicLogSummary", () => {
  it("computes the numbers a council asks for", () => {
    const rs = [
      req({ id: "a" }),
      req({ id: "b", closedAt: new Date("2026-08-05T10:00:00Z") }), // on time, 4 days
      req({ id: "c", closedAt: new Date("2026-09-01T10:00:00Z") }), // late, 31 days
    ];
    const s = publicLogSummary(rs);
    expect(s).toMatchObject({ total: 3, open: 1, closed: 2, onTimeRate: 50 });
    expect(s.medianDaysToClose).toBe(4);
  });

  it("is honest with an empty log", () => {
    expect(publicLogSummary([])).toMatchObject({ total: 0, onTimeRate: null, medianDaysToClose: null });
  });
});
