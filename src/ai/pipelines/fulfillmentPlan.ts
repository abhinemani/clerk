/**
 * Fulfillment planning pipeline (spec §16.1, fulfillment agent v1).
 *
 * Decomposes one request's interpreted scope into a search-and-route plan:
 * independently workable scope items, each with a corpus search query and an
 * optional department routing (from the provided list only). The fulfillment
 * service turns the plan into harness steps — searches run Tier 1, task
 * dispatches park at the /app/agents checkpoint (§16.3) unless the agency has
 * opted Tier-2 sends in.
 *
 * The planner PLANS only. It never touches classification, release, or
 * redaction — those live behind their own tiers and humans.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import {
  FULFILLMENT_PLAN_PROMPT_VERSION,
  FULFILLMENT_PLAN_SYSTEM,
  buildFulfillmentPlanUser,
  type FulfillmentPlanPromptInput,
} from "../prompts/fulfillmentPlan";

export const fulfillmentPlanSchema = z
  .object({
    scope_items: z.array(
      z
        .object({
          label: z.string(),
          search_query: z.string(),
          record_type: z.string().nullable(),
          department: z.string().nullable(),
          task_scope: z.string().nullable(),
          rationale: z.string(),
        })
        .strict(),
    ),
    memo_note: z.string().nullable(),
  })
  .strict();

export type FulfillmentPlanOutput = z.infer<typeof fulfillmentPlanSchema>;
export type FulfillmentScopeItem = FulfillmentPlanOutput["scope_items"][number];

export type FulfillmentPlanInput = FulfillmentPlanPromptInput;

export const fulfillmentPlanPipeline: PipelineDefinition<
  FulfillmentPlanInput,
  FulfillmentPlanOutput
> = {
  name: "fulfillment_plan",
  promptVersion: FULFILLMENT_PLAN_PROMPT_VERSION,
  schema: fulfillmentPlanSchema,
  jsonSchema: zodToJsonSchema(fulfillmentPlanSchema, {
    name: "fulfillment_plan",
    target: "openApi3",
  }) as Record<string, unknown>,
  buildPrompt: (input) => ({
    system: FULFILLMENT_PLAN_SYSTEM,
    user: buildFulfillmentPlanUser(input),
  }),
};

/** Hard cap on scope items — the schema carries no bounds (HANDOFF gotcha 9:
 *  numeric/array bounds in a pipeline schema are rejected silently), so the
 *  consumer clamps on read. */
export const MAX_SCOPE_ITEMS = 6;

/**
 * Clamp a plan for safe downstream use: cap the item count, drop items with
 * an empty query, and null out any department not in the provided list —
 * the "never invent a department" guardrail enforced in code, not prompt.
 */
export function clampFulfillmentPlan(
  plan: FulfillmentPlanOutput,
  departments: Array<{ name: string }>,
): FulfillmentPlanOutput {
  const valid = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.name]));
  return {
    memo_note: plan.memo_note,
    scope_items: plan.scope_items
      .filter((i) => i.search_query.trim().length > 0)
      .slice(0, MAX_SCOPE_ITEMS)
      .map((i) => {
        const match = i.department ? valid.get(i.department.trim().toLowerCase()) : undefined;
        return {
          ...i,
          department: match ?? null,
          task_scope: match ? i.task_scope : null,
        };
      }),
  };
}

/**
 * Deterministic fallback plan — self-contained first: with no model available
 * (or a failed pipeline run) the agent still works from the triage record.
 * One item per identified record type, else the whole scope as one item.
 * No department routing (routing without the model stays with the existing
 * rule/play pipeline at intake).
 */
export function fallbackFulfillmentPlan(input: {
  interpretedScope: string;
  recordTypes: string[];
}): FulfillmentPlanOutput {
  const scope = input.interpretedScope.trim();
  const types = input.recordTypes.map((t) => t.trim()).filter(Boolean).slice(0, MAX_SCOPE_ITEMS - 1);
  const items: FulfillmentPlanOutput["scope_items"] =
    types.length > 0
      ? types.map((t) => ({
          label: `${t} responsive to the request`,
          search_query: `${t} ${scope}`.slice(0, 200),
          record_type: t,
          department: null,
          task_scope: null,
          rationale: `Record type identified at triage; searched with the request's own terms.`,
        }))
      : [];
  items.push({
    label: "Full interpreted scope",
    search_query: scope.slice(0, 200),
    record_type: null,
    department: null,
    task_scope: null,
    rationale: "The whole scope as one search — the deterministic baseline.",
  });
  return {
    scope_items: items.slice(0, MAX_SCOPE_ITEMS),
    memo_note:
      "Plan built without the model (deterministic fallback): one search per triaged record type plus the full scope. Department routing stays with the intake routing pipeline.",
  };
}
