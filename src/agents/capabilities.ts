/**
 * Capability wiring (spec §16.2) — adapts the §6 pipelines and deterministic
 * passes into agent `Capability` implementations, registered in a
 * `CapabilityRegistry` the run harness executes.
 *
 * This is the seam the whole design was built around: "agents are orchestrations
 * over existing pipelines and tools, not new capabilities." The harness enforces
 * allowlist → tier → scope → budget; here we say what each capability actually
 * does. Everything stays injectable, so it's testable with a fake model.
 */
import type { ModelClient } from "@/ai/modelClient";
import { runPipeline, type PipelineDefinition, type PipelineRunRecord } from "@/ai/runPipeline";
import { routingPipeline } from "@/ai/pipelines/routing";
import { correspondencePipeline } from "@/ai/pipelines/correspondence";
import { scanPii, summarizePii } from "@/ai/redaction/piiScan";
import {
  MapCapabilityRegistry,
  type Capability,
  type CapabilityContext,
  type CapabilityResult,
} from "./tools";

export interface CapabilityDeps {
  modelClient: ModelClient;
  /**
   * Corpus/connector search implementation (needs the DB + embeddings, wired
   * later). If omitted, those capabilities are simply not registered — an agent
   * that steps into one gets the harness's clear "no implementation" halt.
   */
  corpusSearch?: (input: Record<string, unknown>, ctx: CapabilityContext) => Promise<CapabilityResult>;
  /** Forwards each pipeline run record to the audit log (§6). */
  onPipelineRun?: (record: PipelineRunRecord) => void | Promise<void>;
}

/** Wrap a §6 pipeline as an agent capability. */
function pipelineCapability<I, O>(
  name: Capability["name"],
  pipeline: PipelineDefinition<I, O>,
  deps: CapabilityDeps,
): Capability {
  return {
    name,
    async execute(input, ctx) {
      const res = await runPipeline(pipeline, input as unknown as I, {
        modelClient: deps.modelClient,
        onRun: deps.onPipelineRun,
        requestId: ctx.requestId,
        agencyId: ctx.agencyId,
      });
      return { output: res.output, tokens: res.usage.inputTokens + res.usage.outputTokens };
    },
  };
}

/**
 * Build the registry the agents run against. Pipeline-backed and deterministic
 * capabilities are always available; corpus search is added only when provided.
 */
export function buildCapabilityRegistry(deps: CapabilityDeps): MapCapabilityRegistry {
  const registry = new MapCapabilityRegistry();

  // Pipeline-backed (§6.3, §6.6).
  registry.register(pipelineCapability("propose_task", routingPipeline, deps));
  registry.register(pipelineCapability("draft_message", correspondencePipeline, deps));

  // Deterministic (§6.5 step 1) — no model call, so zero token cost.
  registry.register({
    name: "suggest_redactions",
    async execute(input) {
      const text = String((input as { text?: unknown }).text ?? "");
      const findings = scanPii(text);
      return { output: { findings, summary: summarizePii(findings) }, tokens: 0 };
    },
  });

  // Injected retrieval (§6.4) — public/full scope enforced by the harness + here.
  if (deps.corpusSearch) {
    const search = deps.corpusSearch;
    registry.register({ name: "corpus_search", execute: (i, c) => search(i, c) });
    registry.register({ name: "connector_search", execute: (i, c) => search(i, c) });
  }

  return registry;
}
