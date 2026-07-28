/**
 * Drafted-correspondence pipeline (spec §6.6).
 *
 * Every outbound touchpoint gets a context-aware draft: acknowledgment,
 * clarification, extension, fee estimate, partial/final release, denial, closure.
 * The draft is a proposal — a named human edits and sends (§10).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import {
  CORRESPONDENCE_PROMPT_VERSION,
  CORRESPONDENCE_SYSTEM,
  buildCorrespondenceUser,
  type CorrespondenceKind,
} from "../prompts/correspondence";

export const correspondenceSchema = z
  .object({
    subject: z.string(),
    body: z.string(),
    /** Gaps the draft couldn't fill from context (e.g. missing appeal language). */
    warnings: z.array(z.string()),
  })
  .strict();

export type CorrespondenceOutput = z.infer<typeof correspondenceSchema>;

export interface CorrespondenceInput {
  kind: CorrespondenceKind;
  tone?: "plain" | "formal";
  /** Facts the letter draws on: public_id, requester, due date, citations, fees… */
  context: Record<string, unknown>;
}

export const correspondencePipeline: PipelineDefinition<CorrespondenceInput, CorrespondenceOutput> = {
  name: "correspondence",
  promptVersion: CORRESPONDENCE_PROMPT_VERSION,
  // Letters are prose; give the model more room than a structured-extraction call.
  maxTokens: 2048,
  schema: correspondenceSchema,
  jsonSchema: zodToJsonSchema(correspondenceSchema, {
    name: "correspondence",
    target: "openApi3",
  }) as Record<string, unknown>,
  buildPrompt: (input) => ({
    system: CORRESPONDENCE_SYSTEM,
    user: buildCorrespondenceUser(input),
  }),
};
