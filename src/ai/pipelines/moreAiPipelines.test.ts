/** Tests for classify (§9.3), summarize (§6.7), and copilot (§6.8) pipelines. */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../modelClient";
import { runPipeline } from "../runPipeline";
import { classifyDocumentPipeline, type ClassifyDocumentOutput } from "./classifyDocument";
import { summarizePipeline, type SummarizeOutput } from "./summarize";
import { copilotPipeline, type CopilotOutput } from "./copilot";

describe("classifyDocument (§9.3)", () => {
  it("returns record type, department, classification, and metadata", async () => {
    const out: ClassifyDocumentOutput = {
      recordType: "contract",
      department: "City Clerk",
      classification: "public",
      suggestedMetadata: [{ key: "vendor", value: "Acme" }, { key: "amount", value: "1200000" }],
      sensitivityNote: null,
    };
    const res = await runPipeline(
      classifyDocumentPipeline,
      { filename: "acme.pdf", text: "Contract with Acme Paving...", departments: ["City Clerk", "Public Works"] },
      { modelClient: new FakeModelClient([out]) },
    );
    expect(res.output.recordType).toBe("contract");
    expect(res.output.classification).toBe("public");
    expect(res.output.suggestedMetadata[0]!.key).toBe("vendor");
  });
});

describe("summarize (§6.7)", () => {
  it("produces a title, summary, and tags", async () => {
    const out: SummarizeOutput = { title: "Acme Paving Contract", summary: "Street resurfacing.", tags: ["contract", "public works"] };
    const res = await runPipeline(summarizePipeline, { text: "..." }, { modelClient: new FakeModelClient([out]) });
    expect(res.output.title).toContain("Acme");
    expect(res.output.tags).toContain("contract");
  });
});

describe("copilot (§6.8)", () => {
  it("replies and proposes draft actions grounded in the request context", async () => {
    const out: CopilotOutput = {
      reply: "Public Works owes inspection reports; I can nudge them.",
      proposedActions: [{ type: "propose_task", detail: "Public Works: inspection reports for 400 Main St" }],
    };
    const res = await runPipeline(
      copilotPipeline,
      {
        request: { publicId: "PR-2026-00341", interpretedScope: "Inspection reports 400 Main St", status: "in_progress", recentEvents: ["Routed to Public Works"] },
        message: "what's blocking this?",
      },
      { modelClient: new FakeModelClient([out]) },
    );
    expect(res.output.proposedActions[0]!.type).toBe("propose_task");
    // Everything is a draft — the schema has no "send"/"execute" field.
    expect(Object.keys(copilotPipeline.schema.parse(out))).toEqual(["reply", "proposedActions"]);
  });
});
