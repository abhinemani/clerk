/** Tests for the fulfillment agent running through the harness (§16.1). */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import { LexicalRetriever } from "@/ai/search/retriever";
import { FakeModelClient } from "@/ai/modelClient";
import type { RoutingOutput } from "@/ai/pipelines/routing";
import { runFulfillment } from "./fulfillmentAgent";

const retriever = new LexicalRetriever(DEMO_CORPUS);

const routing: RoutingOutput = {
  assignments: [{ department: "Public Works", scope: "Inspection reports for 400 Main St.", rationale: "holds them" }],
  uncovered: ["Any related police incident reports"],
};

const INPUT = {
  request: {
    publicId: "PR-2026-00341",
    interpretedScope: "Inspection reports and paving records for 400 Main St, 2024–present.",
    recordTypes: ["inspection reports", "contract"],
  },
  departments: [
    { name: "Public Works", description: "Inspections, permits, streets." },
    { name: "Police Records", description: "Incident reports." },
  ],
};

describe("runFulfillment", () => {
  it("orchestrates search → review set → routing → memo through the harness", async () => {
    const res = await runFulfillment(INPUT, { retriever, modelClient: new FakeModelClient([routing]) });

    expect(res.outcome).toBe("completed");
    // It actually searched the corpus and assembled a review set.
    expect(res.candidates.length).toBeGreaterThan(0);
    expect(res.reviewSet.length).toBe(res.candidates.length);
    // It proposed department tasks via the routing pipeline.
    expect(res.assignments[0]!.department).toBe("Public Works");
    expect(res.uncovered.length).toBe(1);
    // It wrote a status memo summarizing the work.
    expect(res.memo).toContain("PR-2026-00341");
    expect(res.memo).toContain("review set");
    expect(res.memo).toContain("Public Works");
  });

  it("records every step as an autonomous agent action in the audit log", async () => {
    const res = await runFulfillment(INPUT, { retriever, modelClient: new FakeModelClient([routing]) });
    const caps = res.events.map((e) => e.payload.capability);
    expect(caps).toEqual(["read_request", "corpus_search", "assemble_review_set", "propose_task", "status_memo"]);
    expect(res.events.every((e) => e.kind === "agent_action")).toBe(true);
  });

  it("still writes a coherent memo when the corpus has no hits", async () => {
    const res = await runFulfillment(
      { ...INPUT, request: { ...INPUT.request, interpretedScope: "body camera footage from the July 4 parade" } },
      { retriever, modelClient: new FakeModelClient([{ assignments: [], uncovered: ["body-cam footage"] }]) },
    );
    expect(res.outcome).toBe("completed");
    expect(res.candidates).toEqual([]);
    expect(res.memo).toContain("no corpus hits");
  });
});
