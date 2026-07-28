/**
 * Archive summarization (spec §6.7): every public release gets an AI-generated
 * title, summary, and topic tags for the searchable public archive.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";

export const summarizeSchema = z
  .object({
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
  })
  .strict();

export type SummarizeOutput = z.infer<typeof summarizeSchema>;

export interface SummarizeInput {
  filename?: string;
  text: string;
}

const SYSTEM = `You write a short public-archive listing for a released government record: a clear title, a 1–2 sentence plain-language summary, and a few topic tags. Describe only what the document is; never speculate beyond its contents. Return ONLY the structured JSON.`;

export const summarizePipeline: PipelineDefinition<SummarizeInput, SummarizeOutput> = {
  name: "summarize_release",
  promptVersion: "2026-07-27.1",
  schema: summarizeSchema,
  jsonSchema: zodToJsonSchema(summarizeSchema, { name: "summarize_release", target: "openApi3" }) as Record<
    string,
    unknown
  >,
  buildPrompt: (input) => ({
    system: SYSTEM,
    user: `${input.filename ? `Filename: ${input.filename}\n` : ""}Document:\n"""\n${input.text.slice(0, 6000)}\n"""`,
  }),
};
