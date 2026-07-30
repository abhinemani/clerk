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
          /** Model's confidence this department holds responsive records (0–1). */
          confidence: z.number().min(0).max(1),
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
