/**
 * Intake understanding & triage pipeline (spec §6.1).
 *
 * On submission, classify the request into a reviewable draft: interpreted
 * scope, record types, date range, custodians, ambiguity flags, requester-type
 * guess, complexity score, not-a-records-request detection, and statutory red
 * flags. AI proposes; the coordinator disposes.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import {
  INTAKE_TRIAGE_PROMPT_VERSION,
  INTAKE_TRIAGE_SYSTEM,
  buildIntakeTriageUser,
} from "../prompts/intakeTriage";

// Mirrors the Requester.type enum in the schema (§5).
export const requesterTypeGuess = z.enum([
  "media",
  "legal",
  "commercial",
  "individual",
  "government",
  "anonymous",
]);

export const intakeTriageSchema = z
  .object({
    interpreted_scope: z.string(),
    record_types: z.array(z.string()),
    date_range: z
      .object({
        start: z.string().nullable(),
        end: z.string().nullable(),
        explicit: z.boolean(),
      })
      .strict(),
    custodians: z.array(z.string()),
    ambiguity_flags: z.array(
      z
        .object({
          issue: z.string(),
          suggested_question: z.string(),
        })
        .strict(),
    ),
    requester_type_guess: requesterTypeGuess,
    // 0.0 (trivial) .. 1.0 (very broad). No numeric bounds in the JSON schema
    // (structured outputs don't support min/max); the harness/UI clamp on read.
    complexity_score: z.number(),
    likely_not_a_records_request: z.boolean(),
    suggested_redirect: z.string().nullable(),
    statutory_red_flags: z.array(z.string()),
  })
  .strict();

export type IntakeTriageOutput = z.infer<typeof intakeTriageSchema>;

export interface IntakeTriageInput {
  rawText: string;
  /** Phase-4 precedents: how the office resolved similar past requests. */
  precedents?: import("../prompts/intakeTriage").PromptPrecedent[];
  /** Learning-loop v2: aggregate stats for the matched request pattern. */
  play?: import("../prompts/intakeTriage").PromptPlayContext;
}

export const intakeTriagePipeline: PipelineDefinition<IntakeTriageInput, IntakeTriageOutput> = {
  name: "intake_triage",
  promptVersion: INTAKE_TRIAGE_PROMPT_VERSION,
  schema: intakeTriageSchema,
  jsonSchema: zodToJsonSchema(intakeTriageSchema, {
    name: "intake_triage",
    target: "openApi3",
  }) as Record<string, unknown>,
  buildPrompt: (input) => ({
    system: INTAKE_TRIAGE_SYSTEM,
    user: buildIntakeTriageUser(input),
  }),
};

/** Clamp the model's complexity score into [0, 1] for safe downstream use. */
export function clampComplexity(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.min(1, Math.max(0, score));
}
