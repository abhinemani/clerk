/** Tests for the requester multi-turn agent + deflection logging (§6.7, §16.1). */
import { describe, expect, it } from "vitest";
import { DEMO_CORPUS } from "@/lib/corpus";
import { LexicalRetriever } from "../search/retriever";
import { FakeModelClient } from "../modelClient";
import { converse, type RequesterAgentOutput } from "./requesterAgent";
import { InMemoryRepository, type Agency } from "@/services/repository";
import type { ServiceDeps } from "@/services/deps";
import { deflectionSummary, logDeflection } from "@/services/deflectionService";

const retriever = new LexicalRetriever(DEMO_CORPUS);
const opts = (script: unknown[]) => ({ retriever, pipelineOpts: { modelClient: new FakeModelClient(script) } });

describe("converse", () => {
  it("answers from public docs with a validated citation", async () => {
    const out: RequesterAgentOutput = {
      intent: "answer",
      message: "The Acme paving contract is public — here it is.",
      citations: ["d-paving"],
      suggestedRequest: null,
    };
    const res = await converse(opts([out]), { history: [], message: "do you have the acme paving contract?" });
    expect(res.output.intent).toBe("answer");
    expect(res.output.citations).toEqual(["d-paving"]);
    expect(res.citedTitles[0]).toContain("Paving");
  });

  it("asks a clarifying question to narrow a broad ask", async () => {
    const out: RequesterAgentOutput = {
      intent: "clarify",
      message: "Which year of council minutes are you after?",
      citations: [],
      suggestedRequest: null,
    };
    const res = await converse(opts([out]), { history: [], message: "council minutes" });
    expect(res.output.intent).toBe("clarify");
  });

  it("falls back to filing when it claims to answer but cites nothing valid", async () => {
    const out: RequesterAgentOutput = { intent: "answer", message: "here", citations: ["d-nope"], suggestedRequest: null };
    const res = await converse(opts([out]), { history: [], message: "the acme paving contract" });
    expect(res.output.intent).toBe("draft_request");
    expect(res.output.suggestedRequest).toBeTruthy();
  });

  it("never surfaces internal docs to the requester", async () => {
    const out: RequesterAgentOutput = { intent: "answer", message: "x", citations: ["d-personnel"], suggestedRequest: null };
    const res = await converse(opts([out]), { history: [], message: "officer smith personnel disciplinary file" });
    expect(res.output.citations).not.toContain("d-personnel");
    expect(res.output.intent).toBe("draft_request"); // no valid public citation → punt
  });
});

describe("deflection logging", () => {
  const AGENCY: Agency = { id: "ag-1", slug: "r", name: "R", stateCode: "CA", observedHolidays: [] };
  function ctx() {
    const repo = new InMemoryRepository().seedAgency(AGENCY);
    let n = 0;
    const deps: ServiceDeps = { repo, now: () => new Date("2026-07-27T12:00:00Z"), genId: () => `id-${++n}`, genToken: () => "t" };
    return deps;
  }

  it("logs deflections and totals staff-hours avoided (the ROI number)", async () => {
    const deps = ctx();
    await logDeflection(deps, { agencyId: "ag-1", kind: "download", query: "acme paving" });
    await logDeflection(deps, { agencyId: "ag-1", kind: "scope_down", query: "2025 minutes" });
    const summary = await deflectionSummary(deps, "ag-1");
    expect(summary.count).toBe(2);
    expect(summary.downloads).toBe(1);
    expect(summary.staffHoursAvoided).toBe(2); // 1.5 + 0.5
  });
});
