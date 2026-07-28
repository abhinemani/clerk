/**
 * Requester-side multi-turn agent (spec §6.7, §16.1) — extends the answer engine
 * from single-shot to a conversation: answer → narrow → file. Public corpus
 * only, enforced in the query layer; citations validated against provided docs.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition, RunPipelineOptions } from "../runPipeline";
import { runPipeline } from "../runPipeline";
import {
  REQUESTER_AGENT_PROMPT_VERSION,
  REQUESTER_AGENT_SYSTEM,
  buildRequesterAgentUser,
} from "../prompts/requesterAgent";
import { assertPublicOnly, type Retriever } from "../search/retriever";

export const requesterAgentSchema = z
  .object({
    intent: z.enum(["answer", "clarify", "draft_request"]),
    message: z.string(),
    citations: z.array(z.string()),
    suggestedRequest: z.string().nullable(),
  })
  .strict();

export type RequesterAgentOutput = z.infer<typeof requesterAgentSchema>;

export interface RequesterAgentInput {
  history: Array<{ role: "user" | "assistant"; text: string }>;
  message: string;
  documents: Array<{ id: string; title: string; snippet: string }>;
}

export const requesterAgentPipeline: PipelineDefinition<RequesterAgentInput, RequesterAgentOutput> = {
  name: "requester_agent",
  promptVersion: REQUESTER_AGENT_PROMPT_VERSION,
  maxTokens: 1024,
  schema: requesterAgentSchema,
  jsonSchema: zodToJsonSchema(requesterAgentSchema, { name: "requester_agent", target: "openApi3" }) as Record<
    string,
    unknown
  >,
  buildPrompt: (input) => ({
    system: REQUESTER_AGENT_SYSTEM,
    user: buildRequesterAgentUser(input),
  }),
};

export interface ConverseResult {
  output: RequesterAgentOutput;
  citedTitles: string[];
}

/** One conversation turn: public retrieval → agent step → citation validation. */
export async function converse(
  deps: { retriever: Retriever; pipelineOpts: RunPipelineOptions },
  input: { history: Array<{ role: "user" | "assistant"; text: string }>; message: string },
): Promise<ConverseResult> {
  const candidates = await deps.retriever.search(input.message, { scope: "public", limit: 5 });
  assertPublicOnly(candidates);
  const documents = candidates.map((c) => ({ id: c.id, title: c.title, snippet: c.snippet }));

  const { output } = await runPipeline(
    requesterAgentPipeline,
    { history: input.history, message: input.message, documents },
    deps.pipelineOpts,
  );

  const providedIds = new Set(candidates.map((c) => c.id));
  const citations = output.citations.filter((id) => providedIds.has(id));
  // If it claimed to answer but nothing valid was cited, fall back to filing.
  const safe: RequesterAgentOutput =
    output.intent === "answer" && citations.length === 0
      ? { intent: "draft_request", message: output.message, citations: [], suggestedRequest: output.suggestedRequest ?? input.message }
      : { ...output, citations };

  return { output: safe, citedTitles: candidates.filter((c) => citations.includes(c.id)).map((c) => c.title) };
}
