/** Tests for the custodian-suggestion pipeline (inter-agency referral, phase 2). */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../modelClient";
import { runPipeline } from "../runPipeline";
import {
  custodianProposals,
  custodianSuggestPipeline,
  custodianSuggestSchema,
  type CustodianSuggestOutput,
} from "./custodianSuggest";

const DIRECTORY = [
  { id: "dir-school", name: "Riverton Unified School District", recordTypes: ["student records", "school board minutes"] },
  { id: "dir-county", name: "Marlin County Recorder", recordTypes: ["deeds", "property records"] },
];

const input = {
  agencyName: "City of Riverton",
  interpretedScope: "Disciplinary file for a student at Riverton High, 2025–2026 school year.",
  recordTypes: ["student discipline records"],
  directory: DIRECTORY,
};

const refer: CustodianSuggestOutput = {
  belongsToThisAgency: false,
  suggestions: [
    {
      directoryEntryId: "dir-school",
      confidence: 0.92,
      rationale: "Student discipline files are kept by the school district, not the city.",
    },
  ],
};

describe("schema", () => {
  it("accepts a well-formed result and rejects unknown fields", () => {
    expect(custodianSuggestSchema.safeParse(refer).success).toBe(true);
    expect(custodianSuggestSchema.safeParse({ ...refer, extra: 1 }).success).toBe(false);
  });

  it("clamps an out-of-range confidence on read (the schema carries no bounds)", () => {
    // Bounds can't live in the JSON schema — structured outputs reject min/max.
    const overshoot = { ...refer, suggestions: [{ ...refer.suggestions[0]!, confidence: 1.4 }] };
    expect(custodianSuggestSchema.safeParse(overshoot).success).toBe(true);
    expect(custodianProposals(overshoot, DIRECTORY)[0]!.confidence).toBe(1);
  });
});

describe("pipeline run (fake model)", () => {
  it("puts who we are and the directory ids in the prompt", async () => {
    const client = new FakeModelClient([refer]);
    const res = await runPipeline(custodianSuggestPipeline, input, { modelClient: client });
    expect(res.output.belongsToThisAgency).toBe(false);
    expect(client.calls[0]!.user).toContain("City of Riverton");
    expect(client.calls[0]!.user).toContain("dir-school");
    expect(client.calls[0]!.user).toContain("Marlin County Recorder");
    expect(client.calls[0]!.system).toMatch(/default to true/i);
  });
});

describe("custodianProposals", () => {
  it("surfaces a confident, resolvable suggestion with the entry's real name", () => {
    const [p] = custodianProposals(refer, DIRECTORY);
    expect(p).toMatchObject({ directoryEntryId: "dir-school", name: "Riverton Unified School District" });
  });

  it("shows nothing when the model says the records are ours — even if it also suggested a target", () => {
    // A self-contradicting answer resolves toward keeping the request, never
    // toward bouncing a resident who came to the right place.
    expect(custodianProposals({ ...refer, belongsToThisAgency: true }, DIRECTORY)).toEqual([]);
  });

  it("drops ids that aren't in the directory", () => {
    const hallucinated = {
      belongsToThisAgency: false,
      suggestions: [{ directoryEntryId: "dir-invented", confidence: 0.99, rationale: "x" }],
    };
    expect(custodianProposals(hallucinated, DIRECTORY)).toEqual([]);
  });

  it("drops low-confidence guesses", () => {
    const unsure = { ...refer, suggestions: [{ ...refer.suggestions[0]!, confidence: 0.3 }] };
    expect(custodianProposals(unsure, DIRECTORY)).toEqual([]);
  });

  it("orders by confidence, highest first", () => {
    const two: CustodianSuggestOutput = {
      belongsToThisAgency: false,
      suggestions: [
        { directoryEntryId: "dir-county", confidence: 0.6, rationale: "maybe" },
        { directoryEntryId: "dir-school", confidence: 0.9, rationale: "clearly" },
      ],
    };
    expect(custodianProposals(two, DIRECTORY).map((p) => p.directoryEntryId)).toEqual([
      "dir-school",
      "dir-county",
    ]);
  });
});
