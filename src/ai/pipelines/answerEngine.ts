/**
 * Requester answer engine (spec §6.7) — deflection as the front door.
 *
 * Runs the grounded pipeline over PUBLIC candidates only. `answerQuestion`
 * composes retrieval + generation with the hard guarantees: retrieval is
 * public-scoped and asserted internal-free; the model's citations are validated
 * to reference only provided public docs (a hallucinated or internal citation is
 * dropped). Answered vs. correctly-punted is what the §13 eval grades.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import { runPipeline, type RunPipelineOptions } from "../runPipeline";
import {
  ANSWER_ENGINE_PROMPT_VERSION,
  ANSWER_ENGINE_SYSTEM,
  buildAnswerEngineUser,
} from "../prompts/answerEngine";
import { assertPublicOnly, type Retriever } from "../search/retriever";

export const answerEngineSchema = z
  .object({
    answered: z.boolean(),
    answer: z.string().nullable(),
    /** Document ids supporting the answer (must be from the provided set). */
    citations: z.array(z.string()),
    /** When it can't answer, a tight request scope to file instead. */
    suggestedRequestScope: z.string().nullable(),
  })
  .strict();

export type AnswerEngineOutput = z.infer<typeof answerEngineSchema>;

export interface AnswerEngineInput {
  question: string;
  documents: Array<{ id: string; title: string; snippet: string }>;
}

export const answerEnginePipeline: PipelineDefinition<AnswerEngineInput, AnswerEngineOutput> = {
  name: "answer_engine",
  promptVersion: ANSWER_ENGINE_PROMPT_VERSION,
  maxTokens: 1024,
  schema: answerEngineSchema,
  jsonSchema: zodToJsonSchema(answerEngineSchema, { name: "answer_engine", target: "openApi3" }) as Record<
    string,
    unknown
  >,
  buildPrompt: (input) => ({
    system: ANSWER_ENGINE_SYSTEM,
    user: buildAnswerEngineUser(input),
  }),
};

export interface AnsweredResult {
  output: AnswerEngineOutput;
  /** The public candidates the answer was grounded in. */
  citedTitles: string[];
  /** Citations the model produced that were NOT in the provided set (dropped). */
  droppedCitations: string[];
}

/**
 * End-to-end: retrieve public docs → ground an answer → validate citations.
 * Guarantees the answer only ever references provided public documents.
 */
export async function answerQuestion(
  deps: { retriever: Retriever; pipelineOpts: RunPipelineOptions },
  question: string,
): Promise<AnsweredResult> {
  // 1. Public-only retrieval (enforced in the query layer + asserted).
  const candidates = await deps.retriever.search(question, { scope: "public", limit: 5 });
  assertPublicOnly(candidates);

  // 2. Grounded generation over exactly those public docs.
  const documents = candidates.map((c) => ({ id: c.id, title: c.title, snippet: c.snippet }));
  const { output } = await runPipeline(answerEnginePipeline, { question, documents }, deps.pipelineOpts);

  // 3. Validate citations: keep only ids that were actually provided.
  const providedIds = new Set(candidates.map((c) => c.id));
  const kept = output.citations.filter((id) => providedIds.has(id));
  const dropped = output.citations.filter((id) => !providedIds.has(id));

  // If the model claimed to answer but every citation was invalid, downgrade to a punt.
  const grounded = output.answered && kept.length > 0;
  const safeOutput: AnswerEngineOutput = grounded
    ? { ...output, citations: kept }
    : {
        answered: false,
        answer: null,
        citations: [],
        suggestedRequestScope: output.suggestedRequestScope ?? question,
      };

  return {
    output: safeOutput,
    citedTitles: candidates.filter((c) => kept.includes(c.id)).map((c) => c.title),
    droppedCitations: dropped,
  };
}
