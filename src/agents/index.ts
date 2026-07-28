/**
 * Clerk agentic layer (spec §16, Phase 5).
 *
 * Agents are orchestrations over the §6 pipelines and §9 data-plane tools — not
 * new capabilities. This module provides the framework that runs them safely:
 *
 *   actionTiers  — the Tier 1/2/3 + forbidden guardrail (§16.3)
 *   budget       — per-run tool-call / token / wall-clock caps (§16.2)
 *   tools        — the capability surface + injectable registry (§16.2)
 *   definitions  — the five agents as allowlisted configs (§16.1)
 *   runHarness   — the resumable, auditable orchestrator (§16.2, §16.3)
 *
 * The capability implementations (corpus search, redaction, email, etc.) are
 * registered from the Phase 2–4 pipelines; the framework depends only on the
 * injected CapabilityRegistry, so it is complete and tested ahead of them.
 */
export * from "./actionTiers";
export * from "./budget";
export * from "./tools";
export * from "./definitions";
export * from "./runHarness";
