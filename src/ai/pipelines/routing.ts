/**
 * Routing-suggestions pipeline (spec §6.3).
 *
 * Given interpreted scope + department descriptions, propose task assignments
 * with a drafted scope per department. The coordinator edits and dispatches;
 * the final routing becomes few-shot signal for future runs (§6.3).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import { ROUTING_PROMPT_VERSION, ROUTING_SYSTEM, buildRoutingUser } from "../prompts/routing";

export const routingSchema = z
  .object({
    assignments: z.array(
      z
        .object({
          department: z.string(),
          scope: z.string(),
          rationale: z.string(),
          // Confidence 0–1. No numeric bounds in the JSON schema — structured
          // outputs reject min/max with a 400, which was silently killing the
          // whole live routing pass (the triage job catches and logs). The
          // triage job clamps on read instead, like intake's complexity_score.
          confidence: z.number(),
        })
        .strict(),
    ),
    uncovered: z.array(z.string()),
  })
  .strict();

export type RoutingOutput = z.infer<typeof routingSchema>;

export interface RoutingInput {
  interpretedScope: string;
  recordTypes: string[];
  departments: Array<{ name: string; description?: string }>;
  /** Phase-4 precedents: departments that fulfilled similar past requests. */
  precedents?: import("../prompts/intakeTriage").PromptPrecedent[];
}

export const routingPipeline: PipelineDefinition<RoutingInput, RoutingOutput> = {
  name: "routing_suggestions",
  promptVersion: ROUTING_PROMPT_VERSION,
  schema: routingSchema,
  jsonSchema: zodToJsonSchema(routingSchema, {
    name: "routing_suggestions",
    target: "openApi3",
  }) as Record<string, unknown>,
  buildPrompt: (input) => ({
    system: ROUTING_SYSTEM,
    user: buildRoutingUser(input),
  }),
};
