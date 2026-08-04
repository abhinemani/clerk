/** Tests for the defensibility report (spec §10). */
import { describe, expect, it } from "vitest";
import type { EventEntity } from "@/services/repository";
import { buildDefensibilityReport, renderAuditText } from "./auditExport";
import { toCsv, metricsCsv } from "./csv";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

function ev(over: Partial<EventEntity>): EventEntity {
  return {
    id: "e",
    agencyId: "ag-1",
    requestId: "r-1",
    kind: "note",
    actorUserId: null,
    summary: "",
    createdAt: at("2026-01-01"),
    ...over,
  };
}

const INPUT = {
  agencyName: "City of Riverton",
  request: {
    publicId: "PR-2026-00341",
    rawText: "Inspection reports for 400 Main St.",
    status: "fulfilled",
    receivedAt: at("2026-01-01"),
    statutoryDueAt: at("2026-01-11"),
  },
  events: [
    ev({ id: "e3", kind: "approval", summary: "Coordinator accepted records", actorUserId: "u-1", createdAt: at("2026-01-05") }),
    ev({ id: "e1", kind: "status_change", summary: "Submitted", createdAt: at("2026-01-01"), payload: { from: "draft", to: "submitted" } }),
    ev({ id: "e2", kind: "ai_action", summary: "Intake triage", createdAt: at("2026-01-02"), payload: { model: "claude-sonnet-5", promptVersion: "2026-07-27.1" } }),
  ],
};

describe("buildDefensibilityReport — actor names", () => {
  it("resolves actorUserId to a real name when given a map, falling back to the id", () => {
    const report = buildDefensibilityReport({
      ...INPUT,
      events: [
        ev({ kind: "approval", summary: "Approved", actorUserId: "u-1" }),
        ev({ kind: "note", summary: "Unknown actor", actorUserId: "u-ghost" }),
        ev({ kind: "ai_action", summary: "AI ran", actorUserId: null }),
      ],
      actorNameById: new Map([["u-1", "Dana Okafor"]]),
    });
    expect(report.entries.map((e) => e.actor)).toEqual(["Dana Okafor", "user:u-ghost", "system/AI"]);
  });

  it("falls back to the raw id form when no map is given (unchanged default behavior)", () => {
    const report = buildDefensibilityReport({
      ...INPUT,
      events: [ev({ kind: "approval", summary: "Approved", actorUserId: "u-1" })],
    });
    expect(report.entries[0]!.actor).toBe("user:u-1");
  });
});

describe("buildDefensibilityReport", () => {
  it("orders the audit trail chronologically and summarizes integrity", () => {
    const report = buildDefensibilityReport(INPUT);
    expect(report.entries.map((e) => e.kind)).toEqual(["status_change", "ai_action", "approval"]);
    expect(report.integrity.aiActions).toBe(1);
    expect(report.integrity.humanApprovals).toBe(1);
    expect(report.integrity.aiActionsFullyAttributed).toBe(true);
  });

  it("flags an AI action missing model/prompt attribution", () => {
    const report = buildDefensibilityReport({
      ...INPUT,
      events: [ev({ kind: "ai_action", summary: "unattributed", payload: {} })],
    });
    expect(report.integrity.aiActionsFullyAttributed).toBe(false);
  });

  it("renders exportable text with the immutable request and the trail", () => {
    const text = renderAuditText(buildDefensibilityReport(INPUT));
    expect(text).toContain("PR-2026-00341");
    expect(text).toContain("Inspection reports for 400 Main St.");
    expect(text).toContain("[ai_action]");
    expect(text).toContain("model=claude-sonnet-5");
  });
});

describe("csv", () => {
  it("quotes cells containing commas/quotes/newlines", () => {
    const csv = toCsv([{ a: "x,y", b: 'he said "hi"' }]);
    expect(csv).toBe('a,b\n"x,y","he said ""hi"""');
  });

  it("builds a metric table", () => {
    expect(metricsCsv([["on_time_rate", 0.94], ["median_days", 8]])).toBe(
      "metric,value\non_time_rate,0.94\nmedian_days,8",
    );
  });
});
