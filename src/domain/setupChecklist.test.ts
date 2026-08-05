/** Go-live checklist: computed from reality, never manually ticked. */
import { describe, expect, it } from "vitest";
import { computeSetupStatus, type SetupSignals } from "./setupChecklist";

const FRESH: SetupSignals = {
  staffCount: 1, // the provisioning admin
  departmentCount: 0,
  routingRuleCount: 0,
  directoryCount: 0,
  publicRecordCount: 0,
  requestCount: 0,
  hasStatuteProfile: true,
  emailConfigured: false,
};

describe("computeSetupStatus", () => {
  it("a fresh agency has one required step remaining: departments", () => {
    const status = computeSetupStatus(FRESH);
    expect(status.complete).toBe(false);
    expect(status.requiredRemaining).toBe(1);
    expect(status.steps.find((s) => s.key === "departments")?.done).toBe(false);
    expect(status.steps.find((s) => s.key === "statute")?.done).toBe(true);
  });

  it("a missing statute profile is required and not fixable in the UI", () => {
    const status = computeSetupStatus({ ...FRESH, hasStatuteProfile: false });
    const statute = status.steps.find((s) => s.key === "statute")!;
    expect(statute.done).toBe(false);
    expect(statute.required).toBe(true);
    expect(statute.href).toBeNull();
    expect(status.requiredRemaining).toBe(2);
  });

  it("the provisioning admin alone does not count as a team", () => {
    expect(computeSetupStatus(FRESH).steps.find((s) => s.key === "staff")?.done).toBe(false);
    expect(
      computeSetupStatus({ ...FRESH, staffCount: 2 }).steps.find((s) => s.key === "staff")?.done,
    ).toBe(true);
  });

  it("a fully set up agency is complete with an honest count", () => {
    const status = computeSetupStatus({
      staffCount: 3,
      departmentCount: 3,
      routingRuleCount: 2,
      directoryCount: 1,
      publicRecordCount: 5,
      requestCount: 4,
      hasStatuteProfile: true,
      emailConfigured: true,
    });
    expect(status.complete).toBe(true);
    expect(status.doneCount).toBe(status.totalCount);
    expect(status.requiredRemaining).toBe(0);
  });

  it("email shows honest outbox-only copy until configured", () => {
    const step = computeSetupStatus(FRESH).steps.find((s) => s.key === "email")!;
    expect(step.done).toBe(false);
    expect(step.detail).toMatch(/outbox-only/i);
  });
});
