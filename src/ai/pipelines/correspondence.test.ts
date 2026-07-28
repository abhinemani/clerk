/** Tests for the drafted-correspondence pipeline (spec §6.6). */
import { describe, expect, it } from "vitest";
import { FakeModelClient } from "../modelClient";
import { runPipeline } from "../runPipeline";
import {
  correspondencePipeline,
  correspondenceSchema,
  type CorrespondenceOutput,
} from "./correspondence";

const draft: CorrespondenceOutput = {
  subject: "Acknowledgment of your public records request PR-2026-00341",
  body: "Dear Jane Doe, we received your request on July 27, 2026. It is due by August 6, 2026...",
  warnings: [],
};

describe("schema", () => {
  it("requires subject, body, and warnings", () => {
    expect(correspondenceSchema.safeParse(draft).success).toBe(true);
    const { subject, ...rest } = draft;
    void subject;
    expect(correspondenceSchema.safeParse(rest).success).toBe(false);
  });
});

describe("pipeline run (fake model)", () => {
  it("drafts an acknowledgment with the letter kind and context in the prompt", async () => {
    const client = new FakeModelClient([draft]);
    const res = await runPipeline(
      correspondencePipeline,
      {
        kind: "acknowledgment",
        context: { public_id: "PR-2026-00341", requester: "Jane Doe", statutory_due_at: "2026-08-06" },
      },
      { modelClient: client },
    );
    expect(res.output.subject).toContain("PR-2026-00341");
    expect(client.calls[0]!.user).toContain("Letter type: acknowledgment");
    expect(client.calls[0]!.user).toContain("2026-08-06");
    expect(client.calls[0]!.system).toMatch(/named staff member/i);
  });

  it("surfaces warnings when the model reports missing context (e.g. denial appeal language)", async () => {
    const withWarning: CorrespondenceOutput = {
      subject: "Denial of your request",
      body: "We are denying your request under the cited exemption...",
      warnings: ["Appeal-rights language was not provided; insert the statutory appeal paragraph."],
    };
    const client = new FakeModelClient([withWarning]);
    const res = await runPipeline(
      correspondencePipeline,
      { kind: "denial", context: { exemption: "Cal. Gov. Code § 7927.705" } },
      { modelClient: client },
    );
    expect(res.output.warnings.length).toBeGreaterThan(0);
  });
});
