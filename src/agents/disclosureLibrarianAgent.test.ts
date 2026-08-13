/** B1 disclosure librarian — first Phase-5 agent, running through the real harness. */
import { describe, expect, it } from "vitest";
import type { DemandSignal } from "@/domain/demandPatterns";
import { runDisclosureSweep } from "./disclosureLibrarianAgent";

const NOW = new Date("2026-08-13T03:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function towingSignals(): DemandSignal[] {
  return [
    { kind: "request", text: "towing contracts with vendors", at: day(40), ref: "PR-1" },
    { kind: "request", text: "city towing contracts", at: day(25), ref: "PR-2" },
    { kind: "deflection_query", text: "towing contracts 2026", at: day(10) },
    { kind: "archive_miss", text: "vendor towing contracts", at: day(5) },
  ];
}

describe("runDisclosureSweep", () => {
  it("completes autonomously: every step is Tier 1, no checkpoint parking", async () => {
    const res = await runDisclosureSweep({ signals: towingSignals(), now: NOW });

    expect(res.outcome).toBe("completed");
    expect(res.patterns).toHaveLength(1);
    expect(res.digest).toContain("consider publishing");

    // One audit event per executed step, all through the harness.
    const proposals = res.events.filter((e) =>
      e.summary.startsWith("propose_publication_candidate"),
    );
    expect(proposals).toHaveLength(1);
    // Proposing is Tier 1 — autonomous, and attributed as an agent action.
    expect(proposals[0]!.payload.tier).toBe(1);
    expect(proposals[0]!.payload.disposition).toBe("autonomous");
    expect(proposals[0]!.payload.autonomousSend).toBe(true);
  });

  it("quiet window → no proposals, just the memo", async () => {
    const res = await runDisclosureSweep({
      signals: [{ kind: "archive_miss", text: "one lonely search", at: day(2) }],
      now: NOW,
    });
    expect(res.outcome).toBe("completed");
    expect(res.patterns).toHaveLength(0);
    expect(res.digest).toContain("No repeated unmet demand");
    expect(res.events.filter((e) => e.summary.startsWith("propose_publication_candidate"))).toHaveLength(0);
  });

  it("the librarian cannot publish: the capability is off-allowlist and would halt the run", async () => {
    // Sanity: the definition's allowlist is the enforcement point (§16.2) —
    // a publish step could never execute even if a plan contained one.
    const { getAgentDefinition } = await import("./definitions");
    expect(getAgentDefinition("disclosure_librarian").allowedCapabilities.has("publish_release" as never)).toBe(false);
  });
});
