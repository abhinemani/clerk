/** Tests for the B2 consistency auditor running through the harness. */
import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/domain/consistencyAudit";
import { runConsistencyAudit } from "./consistencyAuditorAgent";

const NOW = new Date("2026-08-14T07:00:00Z");

const d = (over: Partial<DecisionRecord>): DecisionRecord => ({
  requestPublicId: "PR-2026-00131",
  documentId: "doc-1",
  documentName: "incident-report.pdf",
  recordType: "police report",
  decision: "release",
  exemptionLabel: null,
  decidedAt: new Date("2026-08-01T00:00:00Z"),
  ...over,
});

const DIVERGENT: DecisionRecord[] = [
  d({}),
  d({
    requestPublicId: "PR-2026-00104",
    documentId: "doc-2",
    documentName: "incident-report-2.pdf",
    decision: "release_redacted",
    exemptionLabel: "Privacy (officer names)",
  }),
];

describe("runConsistencyAudit", () => {
  it("flags each finding and completes autonomously (all Tier 1)", async () => {
    const res = await runConsistencyAudit({ decisions: DIVERGENT, now: NOW, agencyId: "ag-1" });
    expect(res.outcome).toBe("completed");
    expect(res.findings).toHaveLength(1);
    const caps = res.events.map((e) => e.payload.capability);
    expect(caps).toEqual(["read_decision_log", "flag_for_review", "status_memo"]);
    // Reads audit as "read"; the Tier-1 flag is an autonomous action.
    const flag = res.events.find((e) => e.payload.capability === "flag_for_review")!;
    expect(flag.payload.tier).toBe(1);
    expect(flag.payload.autonomousSend).toBe(true);
  });

  it("writes an honest digest either way — findings listed, or a clean bill", async () => {
    const dirty = await runConsistencyAudit({ decisions: DIVERGENT, now: NOW });
    expect(dirty.digest).toContain("1 inconsistency finding(s)");
    expect(dirty.digest).toContain("police report");

    const clean = await runConsistencyAudit({ decisions: [d({}), d({ requestPublicId: "PR-2" })], now: NOW });
    expect(clean.findings).toEqual([]);
    expect(clean.digest).toContain("No cross-request inconsistencies found.");
  });

  it("cannot reach a decision-changing action: the allowlist has no hole for it", async () => {
    // The definition's allowlist is the guardrail; assert the run's steps
    // never contain anything beyond the read → flag → memo surface.
    const res = await runConsistencyAudit({ decisions: DIVERGENT, now: NOW });
    const stepNames = res.run.plan.steps.map((s) => s.tool ?? s.action);
    for (const name of stepNames) {
      expect(["read_decision_log", "flag_for_review", "status_memo"]).toContain(name);
    }
  });

  it("persists after every step when a persist hook is provided (§16.2)", async () => {
    let persisted = 0;
    const res = await runConsistencyAudit({
      decisions: DIVERGENT,
      now: NOW,
      runId: "run-b2",
      persist: () => void (persisted += 1),
    });
    expect(res.run.id).toBe("run-b2");
    expect(persisted).toBeGreaterThanOrEqual(res.run.plan.steps.length);
    expect(res.run.status).toBe("completed");
  });
});
