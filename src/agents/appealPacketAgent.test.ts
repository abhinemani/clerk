/** B3 appeal-packet builder — assembly through the real harness, all Tier 1. */
import { describe, expect, it } from "vitest";
import type { RequestEntity } from "@/services/repository";
import { runAppealPacketAssembly } from "./appealPacketAgent";

const NOW = new Date("2026-08-13T12:00:00Z");

const request = {
  id: "req-1",
  agencyId: "ag-1",
  publicId: "PR-2026-00042",
  rawText: "All towing contracts since 2024",
  status: "denied",
  receivedAt: new Date("2026-06-01T09:00:00Z"),
  statutoryDueAt: new Date("2026-06-15T00:00:00Z"),
  closedAt: new Date("2026-07-01T16:00:00Z"),
  createdAt: new Date("2026-06-01T09:00:00Z"),
} as RequestEntity;

describe("runAppealPacketAssembly", () => {
  it("completes autonomously through the harness — every step Tier 1 or a read", async () => {
    const res = await runAppealPacketAssembly({
      agencyId: "ag-1",
      agencyName: "City of Riverton",
      request,
      events: [],
      reviews: [],
      messages: [],
      releases: [],
      now: NOW,
    });

    expect(res.outcome).toBe("completed");
    expect(res.events).toHaveLength(7); // one audit event per plan step
    // Nothing in the plan may require a human or be forbidden — compiling
    // a dossier is internal and reversible by design.
    for (const e of res.events) {
      expect(e.payload.disposition === "autonomous" || e.payload.disposition === "read").toBe(true);
    }
    expect(res.text).toContain("PR-2026-00042");
  });

  it("checksum is stable for identical input and printed into the result", async () => {
    const args = {
      agencyId: "ag-1",
      agencyName: "City of Riverton",
      request,
      events: [],
      reviews: [],
      messages: [],
      releases: [],
      now: NOW,
    };
    const [a, b] = [await runAppealPacketAssembly(args), await runAppealPacketAssembly(args)];
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
