/**
 * Requester-side agent (spec §16.1, §6.7) — the answer engine as a harness-run
 * agent. It searches and answers over the PUBLIC corpus only; the harness pins
 * requester-side retrieval to public scope (§16.3), and citations are validated
 * against the provided public docs. Multi-turn: answer → narrow → file.
 */
import type { AgentPlanStep } from "@/db/schema";
import { runPipeline } from "@/ai/runPipeline";
import type { ModelClient } from "@/ai/modelClient";
import {
  requesterAgentPipeline,
  type RequesterAgentOutput,
} from "@/ai/pipelines/requesterAgent";
import { assertPublicOnly, type Candidate, type Retriever } from "@/ai/search/retriever";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface RequesterSideResult {
  output: RequesterAgentOutput;
  citedTitles: string[];
  /** The retrieval scope the harness enforced (must be "public"). */
  scopeUsed: "public" | "full" | undefined;
  outcome: string;
  events: AgentActionEvent[];
}

function step(index: number, action: string): AgentPlanStep {
  return { index, description: action, status: "pending", action, input: {} };
}

export async function runRequesterSideAgent(
  input: { history: Array<{ role: "user" | "assistant"; text: string }>; message: string },
  deps: { retriever: Retriever; modelClient: ModelClient; policy?: AgencyActionPolicy },
): Promise<RequesterSideResult> {
  const scratch: { candidates: Candidate[]; output: RequesterAgentOutput; scope?: "public" | "full" } = {
    candidates: [],
    output: { intent: "clarify", message: "", citations: [], suggestedRequest: null },
  };

  const corpusSearch: Capability = {
    name: "corpus_search" as never,
    async execute(_input, ctx) {
      // The harness pins ctx.corpusScope to "public" for requester-side agents.
      scratch.scope = ctx.corpusScope;
      scratch.candidates = await deps.retriever.search(input.message, {
        scope: ctx.corpusScope === "full" ? "full" : "public",
        limit: 5,
      });
      assertPublicOnly(scratch.candidates); // public scope → never internal
      return { output: { count: scratch.candidates.length }, tokens: 0 };
    },
  };

  const draftMessage: Capability = {
    name: "draft_message" as never,
    async execute() {
      const documents = scratch.candidates.map((c) => ({ id: c.id, title: c.title, snippet: c.snippet }));
      const { output } = await runPipeline(
        requesterAgentPipeline,
        { history: input.history, message: input.message, documents },
        { modelClient: deps.modelClient },
      );
      scratch.output = output;
      return { output, tokens: 0 };
    },
  };

  const registry = new MapCapabilityRegistry([corpusSearch, draftMessage]);

  const run: AgentRunState = {
    id: "requester-side",
    agencyId: "public",
    status: "planning",
    plan: { goal: "Help a resident find records", cursor: 0, steps: [step(0, "corpus_search"), step(1, "draft_message")] },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("requester_side"),
    policy: deps.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  // Validate citations against the provided public docs (drop invalid/internal).
  const providedIds = new Set(scratch.candidates.map((c) => c.id));
  const citations = scratch.output.citations.filter((id) => providedIds.has(id));
  const safe: RequesterAgentOutput =
    scratch.output.intent === "answer" && citations.length === 0
      ? { intent: "draft_request", message: scratch.output.message, citations: [], suggestedRequest: scratch.output.suggestedRequest ?? input.message }
      : { ...scratch.output, citations };

  return {
    output: safe,
    citedTitles: scratch.candidates.filter((c) => citations.includes(c.id)).map((c) => c.title),
    scopeUsed: scratch.scope,
    outcome: res.outcome,
    events,
  };
}
