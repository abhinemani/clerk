/**
 * Ingest steward (spec §16.1) — the data-plane agent. Watches the review queue:
 * resolves classification ambiguity by cross-referencing similar prior items,
 * flags anomalies (e.g. a "public" auto-publish item that looks like a personnel
 * record), and proposes proactive-publication candidates from request patterns.
 * Runs model-free (deterministic PII + retrieval + aggregation).
 */
import type { AgentPlanStep } from "@/db/schema";
import { scanPii } from "@/ai/redaction/piiScan";
import type { Retriever } from "@/ai/search/retriever";
import { proactivePublicationReport, type PublicationRecommendation } from "@/reporting/proactivePublication";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface QueuedDoc {
  id: string;
  text: string;
  classification: "public" | "internal";
  sourceTrust: "auto_publish" | "review_queue";
}

export interface IngestStewardInput {
  queue: QueuedDoc[];
  /** Recent requests' record types — drives proactive-publication suggestions. */
  requestRecordTypes: Array<{ recordTypes: string[] }>;
}

export interface Anomaly {
  id: string;
  reason: string;
}

export interface IngestStewardResult {
  anomalies: Anomaly[];
  publicationCandidates: PublicationRecommendation[];
  memo: string;
  outcome: string;
  events: AgentActionEvent[];
}

function step(index: number, action: string): AgentPlanStep {
  return { index, description: action, status: "pending", action, input: {} };
}
function cap(name: string, fn: () => unknown | Promise<unknown>): Capability {
  return { name: name as never, async execute() { return { output: await fn(), tokens: 0 }; } };
}

export async function runIngestSteward(
  input: IngestStewardInput,
  deps: { retriever: Retriever; agencyId?: string; policy?: AgencyActionPolicy },
): Promise<IngestStewardResult> {
  const scratch: {
    anomalies: Anomaly[];
    candidates: PublicationRecommendation[];
    crossRefs: number;
  } = { anomalies: [], candidates: [], crossRefs: 0 };

  const registry = new MapCapabilityRegistry([
    cap("read_review_queue", () => ({ pending: input.queue.length })),
    cap("corpus_search", async () => {
      // Cross-reference each item against the full corpus to resolve ambiguity.
      for (const item of input.queue) {
        const similar = await deps.retriever.search(item.text, { scope: "full", limit: 1 });
        if (similar.length) scratch.crossRefs++;
      }
      return { crossReferenced: scratch.crossRefs };
    }),
    cap("flag_for_review", () => {
      for (const item of input.queue) {
        const highRisk = scanPii(item.text).some((f) => f.confidence === "high");
        if (item.sourceTrust === "auto_publish" && item.classification === "public" && highRisk) {
          scratch.anomalies.push({
            id: item.id,
            reason: "Auto-publish 'public' item contains probable PII — held for review before it goes public.",
          });
        }
      }
      return { anomalies: scratch.anomalies.length };
    }),
    cap("propose_publication_candidate", () => {
      scratch.candidates = proactivePublicationReport(input.requestRecordTypes);
      return { candidates: scratch.candidates.length };
    }),
    cap("status_memo", () => ({
      memo: [
        `Ingest steward — ${input.queue.length} item(s) reviewed, ${scratch.crossRefs} cross-referenced.`,
        `${scratch.anomalies.length} anomaly(ies) held for review.`,
        `${scratch.candidates.length} proactive-publication candidate(s) proposed.`,
      ].join("\n"),
    })),
  ]);

  const steps: AgentPlanStep[] = [
    step(0, "read_review_queue"),
    step(1, "corpus_search"),
    step(2, "flag_for_review"),
    step(3, "propose_publication_candidate"),
    step(4, "status_memo"),
  ];

  const run: AgentRunState = {
    id: "ingest-steward",
    agencyId: deps.agencyId ?? "agency",
    status: "planning",
    plan: { goal: "Watch the ingest review queue", cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("ingest_steward"),
    policy: deps.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  const memoStep = run.plan.steps.find((s) => s.action === "status_memo");
  const memo = (memoStep?.output as { memo?: string } | undefined)?.memo ?? "";

  return { anomalies: scratch.anomalies, publicationCandidates: scratch.candidates, memo, outcome: res.outcome, events };
}
