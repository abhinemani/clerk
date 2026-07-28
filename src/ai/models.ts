/**
 * Centralized model configuration (spec §4).
 *
 * "Use Claude Sonnet-class models for all pipelines." Records fulfillment runs
 * many pipeline calls per request across a whole agency, so the Sonnet tier is
 * the deliberate default for cost at scale — kept here so a tier change is one
 * edit. (This intentionally differs from the general "default to Opus" guidance;
 * the spec makes the tier choice a product decision.)
 */
export const MODELS = {
  /** Default for all §6 pipelines. */
  pipeline: "claude-sonnet-5",
  /** For the highest-stakes reasoning (e.g. exemption analysis) if ever needed. */
  highReasoning: "claude-opus-5",
} as const;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Default output cap for structured-extraction pipelines (JSON, not prose). */
export const DEFAULT_MAX_TOKENS = 4096;
