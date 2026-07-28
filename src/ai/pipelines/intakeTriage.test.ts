/** Tests for the intake-triage pipeline (spec §6.1). */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../modelClient";
import { runPipeline } from "../runPipeline";
import {
  clampComplexity,
  intakeTriagePipeline,
  intakeTriageSchema,
  type IntakeTriageOutput,
} from "./intakeTriage";

const validTriage: IntakeTriageOutput = {
  interpreted_scope: "All emails between the mayor and Acme Corp in 2025.",
  record_types: ["emails"],
  date_range: { start: "2025-01-01", end: "2025-12-31", explicit: true },
  custodians: ["Mayor's Office"],
  ambiguity_flags: [],
  requester_type_guess: "media",
  complexity_score: 0.4,
  likely_not_a_records_request: false,
  suggested_redirect: null,
  statutory_red_flags: [],
};

describe("schema", () => {
  it("accepts a well-formed triage object", () => {
    expect(intakeTriageSchema.safeParse(validTriage).success).toBe(true);
  });

  it("rejects unknown/missing fields (strict)", () => {
    expect(intakeTriageSchema.safeParse({ ...validTriage, extra: 1 }).success).toBe(false);
    const { interpreted_scope, ...missing } = validTriage;
    void interpreted_scope;
    expect(intakeTriageSchema.safeParse(missing).success).toBe(false);
  });

  it("produces a JSON schema for the model", () => {
    expect(intakeTriagePipeline.jsonSchema).toBeTypeOf("object");
    expect(JSON.stringify(intakeTriagePipeline.jsonSchema)).toContain("interpreted_scope");
  });

  it("pins a prompt version", () => {
    expect(intakeTriagePipeline.promptVersion).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe("clampComplexity", () => {
  it("clamps into [0,1] and handles NaN", () => {
    expect(clampComplexity(0.5)).toBe(0.5);
    expect(clampComplexity(1.7)).toBe(1);
    expect(clampComplexity(-2)).toBe(0);
    expect(clampComplexity(Number.NaN)).toBe(0);
  });
});

describe("pipeline run (fake model)", () => {
  it("returns a validated triage draft and embeds the raw text in the prompt", async () => {
    const client = new FakeModelClient([validTriage]);
    const res = await runPipeline(
      intakeTriagePipeline,
      { rawText: "I want the mayor's emails with Acme in 2025." },
      { modelClient: client },
    );
    expect(res.output.record_types).toContain("emails");
    expect(res.output.requester_type_guess).toBe("media");
    expect(client.calls[0]!.user).toContain("Acme");
    expect(client.calls[0]!.system).toMatch(/records-intake analyst/);
  });

  it("recovers when the model first returns an invalid shape", async () => {
    const client = new FakeModelClient([
      { interpreted_scope: "x" }, // missing most fields
      validTriage,
    ]);
    const res = await runPipeline(
      intakeTriagePipeline,
      { rawText: "..." },
      { modelClient: client },
    );
    expect(res.attempts).toBe(2);
    expect(res.output.interpreted_scope).toContain("Acme");
  });
});
