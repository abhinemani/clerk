/** Tests for the routing-suggestions pipeline (spec §6.3). */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../modelClient";
import { runPipeline } from "../runPipeline";
import { routingPipeline, routingSchema, type RoutingOutput } from "./routing";

const valid: RoutingOutput = {
  assignments: [
    {
      department: "Public Works",
      scope: "Locate all inspection reports for 400 Main St, Jan 2024–present.",
      rationale: "Inspection reports are held by Public Works.",
      confidence: 0.9,
    },
  ],
  uncovered: ["Any related police incident reports"],
};

const input = {
  interpretedScope: "Inspection reports and any police incidents for 400 Main St since 2024.",
  recordTypes: ["inspection reports", "police reports"],
  departments: [
    { name: "Public Works", description: "Building inspections, permits, infrastructure." },
    { name: "Police Records", description: "Incident and arrest reports." },
  ],
};

describe("schema", () => {
  it("accepts a well-formed routing result and rejects unknown fields", () => {
    expect(routingSchema.safeParse(valid).success).toBe(true);
    expect(routingSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
  });
});

describe("pipeline run (fake model)", () => {
  it("returns validated assignments and lists departments in the prompt", async () => {
    const client = new FakeModelClient([valid]);
    const res = await runPipeline(routingPipeline, input, { modelClient: client });
    expect(res.output.assignments[0]!.department).toBe("Public Works");
    expect(res.output.uncovered).toHaveLength(1);
    expect(client.calls[0]!.user).toContain("Public Works");
    expect(client.calls[0]!.user).toContain("Police Records");
    expect(client.calls[0]!.system).toMatch(/route a public-records request/i);
  });
});
