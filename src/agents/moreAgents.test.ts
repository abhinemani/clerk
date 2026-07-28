/** Tests for the release-prep, ingest-steward, and requester-side agents (§16.1). */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import { LexicalRetriever } from "@/ai/search/retriever";
import { FakeModelClient } from "@/ai/modelClient";
import type { RequesterAgentOutput } from "@/ai/pipelines/requesterAgent";
import { runReleasePrep, type ReviewDoc } from "./releasePrepAgent";
import { runIngestSteward, type QueuedDoc } from "./ingestStewardAgent";
import { runRequesterSideAgent } from "./requesterSideAgent";

const retriever = new LexicalRetriever(DEMO_CORPUS);

describe("release-prep agent — parks at the human signature checkpoint", () => {
  const reviewSet: ReviewDoc[] = [
    {
      id: "doc-1",
      filename: "incident.txt",
      recordType: "police_incident",
      lines: ["Reporting party SSN 123-45-6789", "Home address: 88 Elm Street", "juvenile witness present"],
    },
  ];

  it("runs redaction → exemption log → letter → packet, then STOPS before release", async () => {
    const res = await runReleasePrep({ request: { publicId: "PR-2026-00341" }, reviewSet });
    expect(res.outcome).toBe("awaiting_checkpoint"); // Tier-3 publish_release halts it
    expect(res.parkedAt).toBe("publish_release");
    expect(res.redactions).toBeGreaterThan(0);
    expect(res.exemptionLog.length).toBeGreaterThan(0);
    expect(res.letter).toContain("PR-2026-00341");
    expect(res.checksum).toMatch(/^[0-9a-f]{8}$/);
    // publish_release was never executed — nothing shipped.
    const caps = res.events.map((e) => e.payload.capability);
    expect(caps).toContain("checksum_packet");
    expect(res.events.at(-1)!.payload.disposition).toBe("requires_human");
  });
});

describe("ingest-steward agent", () => {
  const queue: QueuedDoc[] = [
    { id: "q1", text: "Council approved the paving contract.", classification: "public", sourceTrust: "auto_publish" },
    { id: "q2", text: "Vendor SSN 123-45-6789 on the exhibit.", classification: "public", sourceTrust: "auto_publish" },
  ];

  it("flags a public auto-publish item that contains PII, and proposes publication candidates", async () => {
    const res = await runIngestSteward(
      { queue, requestRecordTypes: [{ recordTypes: ["minutes"] }, { recordTypes: ["minutes"] }, { recordTypes: ["minutes"] }] },
      { retriever },
    );
    expect(res.outcome).toBe("completed");
    expect(res.anomalies.map((a) => a.id)).toEqual(["q2"]); // the SSN one
    expect(res.publicationCandidates[0]!.recordType).toBe("minutes");
    expect(res.memo).toContain("anomaly");
  });
});

describe("requester-side agent — public-scope enforced by the harness", () => {
  const answer: RequesterAgentOutput = {
    intent: "answer",
    message: "The Acme paving contract is public.",
    citations: ["d-paving"],
    suggestedRequest: null,
  };

  it("runs corpus_search under PUBLIC scope and answers with a validated citation", async () => {
    const res = await runRequesterSideAgent(
      { history: [], message: "do you have the acme paving contract?" },
      { retriever, modelClient: new FakeModelClient([answer]) },
    );
    expect(res.outcome).toBe("completed");
    expect(res.scopeUsed).toBe("public"); // the harness pinned it
    expect(res.output.citations).toEqual(["d-paving"]);
  });

  it("never lets a requester agent cite an internal record", async () => {
    const sneaky: RequesterAgentOutput = { ...answer, citations: ["d-personnel"] };
    const res = await runRequesterSideAgent(
      { history: [], message: "officer smith personnel disciplinary file" },
      { retriever, modelClient: new FakeModelClient([sneaky]) },
    );
    expect(res.output.citations).not.toContain("d-personnel");
    expect(res.output.intent).toBe("draft_request");
  });
});
