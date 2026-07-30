/** Pure workflow-automation logic tests (auto-assign / auto-dispatch policy). */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_DISPATCH_CONFIDENCE,
  effectiveWorkflowSettings,
  isAssignableRole,
  pickCoordinator,
} from "./workflow";

describe("effectiveWorkflowSettings", () => {
  it("defaults to fully manual — automation is opt-in", () => {
    for (const raw of [null, undefined, {}]) {
      const s = effectiveWorkflowSettings(raw);
      expect(s.autoAssign).toBe(false);
      expect(s.autoDispatch).toBe(false);
      expect(s.autoDispatchConfidence).toBe(DEFAULT_AUTO_DISPATCH_CONFIDENCE);
    }
  });

  it("applies configured values and rejects out-of-range thresholds", () => {
    const s = effectiveWorkflowSettings({ autoAssign: true, autoDispatch: true, autoDispatchConfidence: 0.6 });
    expect(s).toEqual({ autoAssign: true, autoDispatch: true, autoDispatchConfidence: 0.6 });
    expect(effectiveWorkflowSettings({ autoDispatchConfidence: 7 }).autoDispatchConfidence).toBe(
      DEFAULT_AUTO_DISPATCH_CONFIDENCE,
    );
  });
});

describe("pickCoordinator", () => {
  it("picks the least-loaded coordinator", () => {
    expect(
      pickCoordinator([
        { userId: "u-b", openAssigned: 3 },
        { userId: "u-a", openAssigned: 1 },
      ]),
    ).toBe("u-a");
  });

  it("breaks ties deterministically by userId", () => {
    const candidates = [
      { userId: "u-b", openAssigned: 2 },
      { userId: "u-a", openAssigned: 2 },
    ];
    expect(pickCoordinator(candidates)).toBe("u-a");
    expect(pickCoordinator([...candidates].reverse())).toBe("u-a");
  });

  it("returns null with no candidates", () => {
    expect(pickCoordinator([])).toBeNull();
  });
});

describe("isAssignableRole", () => {
  it("admins and coordinators own requests; responders and read-only do not", () => {
    expect(isAssignableRole("admin")).toBe(true);
    expect(isAssignableRole("coordinator")).toBe(true);
    expect(isAssignableRole("responder")).toBe(false);
    expect(isAssignableRole("read_only")).toBe(false);
    expect(isAssignableRole("reviewer")).toBe(false);
  });
});
