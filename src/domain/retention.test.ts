/** Retention + legal hold logic — the guard against spoliation. */
import { describe, expect, it } from "vitest";
import {
  autoHoldReason,
  documentsAtRetentionRisk,
  isAutoHold,
  retentionStatus,
} from "./retention";

const NOW = new Date("2026-08-04T12:00:00Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("retentionStatus", () => {
  it("a legal hold overrides everything, including an expired schedule", () => {
    const s = retentionStatus(
      { retentionUntil: inDays(-500), legalHoldReason: "Responsive to open request PR-2026-00003" },
      NOW,
    );
    expect(s.state).toBe("held");
    expect(s.blocksDestruction).toBe(true);
    expect(s.label).toContain("PR-2026-00003");
  });

  it("flags a document past its retention date as eligible for destruction", () => {
    const s = retentionStatus({ retentionUntil: inDays(-3) }, NOW);
    expect(s.state).toBe("eligible_for_destruction");
    expect(s.daysRemaining).toBe(-3);
    expect(s.label).toContain("ended 3 days ago");
    expect(s.blocksDestruction).toBe(false);
  });

  it("warns inside the window and stays quiet outside it", () => {
    expect(retentionStatus({ retentionUntil: inDays(10) }, NOW).state).toBe("expiring_soon");
    expect(retentionStatus({ retentionUntil: inDays(200) }, NOW).state).toBe("retained");
  });

  it("treats the boundary day as expiring, not expired", () => {
    expect(retentionStatus({ retentionUntil: inDays(30) }, NOW).state).toBe("expiring_soon");
    const today = retentionStatus({ retentionUntil: NOW }, NOW);
    expect(today.state).toBe("eligible_for_destruction");
    expect(today.label).toBe("Retention period ends today");
  });

  it("is honest when there is no schedule — and still protects an open request", () => {
    const bare = retentionStatus({}, NOW);
    expect(bare.state).toBe("unscheduled");
    expect(bare.blocksDestruction).toBe(false);
    expect(bare.label).toBe("No retention schedule on file");

    const open = retentionStatus({ inOpenRequest: true }, NOW);
    expect(open.state).toBe("unscheduled");
    expect(open.blocksDestruction).toBe(true);
    expect(open.label).toContain("open request");
  });

  it("honors a custom warning window", () => {
    expect(retentionStatus({ retentionUntil: inDays(45) }, NOW, 60).state).toBe("expiring_soon");
  });
});

describe("documentsAtRetentionRisk", () => {
  it("returns only unheld documents that are expired or expiring", () => {
    const docs = [
      { id: "safe", retentionUntil: inDays(400) },
      { id: "expiring", retentionUntil: inDays(5) },
      { id: "expired", retentionUntil: inDays(-1) },
      { id: "held", retentionUntil: inDays(-10), legalHoldReason: "Litigation hold" },
      { id: "unscheduled" },
    ];
    const risk = documentsAtRetentionRisk(docs, NOW);
    expect(risk.map((r) => r.doc.id).sort()).toEqual(["expired", "expiring"]);
  });
});

describe("auto-hold reasons", () => {
  it("round-trips: an auto hold is recognizable, a human's note is not", () => {
    const auto = autoHoldReason("PR-2026-00042");
    expect(isAutoHold(auto)).toBe(true);
    expect(isAutoHold("Litigation — Smith v. City")).toBe(false);
    expect(isAutoHold(null)).toBe(false);
  });
});
