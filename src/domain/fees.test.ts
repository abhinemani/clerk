/** Tests for fee-estimate computation (spec §5, §6.6, §7). */
import { describe, expect, it } from "vitest";
import { computeFeeEstimate } from "./fees";
import { stateProfiles } from "@/statute/profiles";

const CA = stateProfiles.CA!.feeRules; // copies + media only, $0.10/page
const TX = stateProfiles.TX!.feeRules; // staff_time + copies + media, $15/hr, $0.10/page
const IL = stateProfiles.IL!.feeRules; // copies only, $0.15/page

describe("chargeability follows statute config", () => {
  it("California excludes staff time but charges copies and media", () => {
    const est = computeFeeEstimate(CA, {
      staffHours: 2,
      copies: 100,
      media: [{ label: "USB drive", amount: 5 }],
    });
    expect(est.excluded).toContain("staff_time");
    const kinds = est.lineItems.map((li) => li.kind);
    expect(kinds).toContain("copies");
    expect(kinds).toContain("media");
    expect(kinds).not.toContain("staff_time");
    expect(est.total).toBe(15); // 100 * 0.10 + 5
  });

  it("Texas charges staff time and copies", () => {
    const est = computeFeeEstimate(TX, { staffHours: 3, copies: 10 });
    expect(est.total).toBe(46); // 3 * 15 + 10 * 0.10
  });
});

describe("free copy allowance", () => {
  it("bills only pages beyond the free allowance", () => {
    const est = computeFeeEstimate(IL, { copies: 60, freeCopyPages: 50 });
    expect(est.total).toBe(1.5); // 10 billable * 0.15
    expect(est.lineItems[0]!.qty).toBe(10);
  });

  it("charges nothing when all pages are within the allowance", () => {
    const est = computeFeeEstimate(IL, { copies: 40, freeCopyPages: 50 });
    expect(est.lineItems).toHaveLength(0);
    expect(est.total).toBe(0);
  });
});

describe("waiver", () => {
  it("zeroes the total but keeps the itemization and reason", () => {
    const est = computeFeeEstimate(TX, { staffHours: 4, copies: 20, waiverReason: "public interest" });
    expect(est.waived).toBe(true);
    expect(est.total).toBe(0);
    expect(est.waiverReason).toBe("public interest");
    expect(est.lineItems.length).toBeGreaterThan(0); // still shows what was waived
  });
});

describe("rounding", () => {
  it("rounds line items to cents", () => {
    const est = computeFeeEstimate(IL, { copies: 3 });
    expect(est.total).toBe(0.45); // 3 * 0.15
  });
});
