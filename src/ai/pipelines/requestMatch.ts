/**
 * Request-match pipeline (docs/answer-first.md, phase 3).
 *
 * "Has someone asked this before, and did we already release the answer?"
 *
 * This is the RERANK half of retrieve-then-rerank. A cheap index (BM25, or
 * Elasticsearch when configured) narrows thousands of prior requests to a
 * handful; this pipeline decides which of those handful actually answer the
 * new ask. Sending the whole corpus to a model would be slow, expensive and
 * worse — cheap retrieval has better recall than an LLM reading a truncated
 * list, and the model's real value is precision.
 *
 * Everything here is a PROPOSAL. A confident match short-circuits a resident's
 * filing decision, so nothing auto-closes: the resident chooses the record, or
 * files anyway. AI proposes, the person disposes — here the person is the
 * requester rather than staff, which makes the precision bar higher, not
 * lower.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import {
  REQUEST_MATCH_PROMPT_VERSION,
  REQUEST_MATCH_SYSTEM,
  buildRequestMatchUser,
} from "../prompts/requestMatch";

export const requestMatchSchema = z
  .object({
    matches: z.array(
      z
        .object({
          publicId: z.string(),
          /** "full" = the new request is satisfied; "partial" = helps narrow. */
          coverage: z.enum(["full", "partial"]),
          // Confidence 0–1. NO numeric bounds here: structured outputs reject
          // min/max on numbers and the call fails SILENTLY (HANDOFF gotcha 9).
          // Clamped on read in matchPriorRequests().
          confidence: z.number(),
          /** Shown to a resident, so it must read as an explanation. */
          rationale: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type RequestMatchOutput = z.infer<typeof requestMatchSchema>;

export interface RequestMatchCandidate {
  publicId: string;
  ask: string;
  outcome: string;
  releasedSummary: string;
}

export interface RequestMatchInput {
  newRequest: string;
  candidates: RequestMatchCandidate[];
}

export const requestMatchPipeline: PipelineDefinition<RequestMatchInput, RequestMatchOutput> = {
  name: "request_match",
  promptVersion: REQUEST_MATCH_PROMPT_VERSION,
  schema: requestMatchSchema,
  jsonSchema: zodToJsonSchema(requestMatchSchema, { target: "openApi3" }) as Record<string, unknown>,
  buildPrompt: (input) => ({
    system: REQUEST_MATCH_SYSTEM,
    user: buildRequestMatchUser(input),
  }),
};

/** Below this we do not put a prior release in front of a resident. Set high
 *  on purpose: the cost of a wrong "you already have your answer" is a request
 *  that never gets filed. */
export const REQUESTER_MATCH_FLOOR = 0.72;
/** Staff can see weaker signals — they are trained, and a wrong hint costs a
 *  glance rather than an unfiled request. */
export const STAFF_MATCH_FLOOR = 0.45;

export interface PriorMatch extends RequestMatchCandidate {
  coverage: "full" | "partial";
  confidence: number;
  rationale: string;
}

/**
 * Fold the model's output back onto the candidates, clamping confidence and
 * dropping anything that names a candidate we did not offer (models
 * occasionally invent an id; an invented publicId must never reach a resident).
 */
export function reconcileMatches(
  output: RequestMatchOutput,
  candidates: RequestMatchCandidate[],
  floor: number,
): PriorMatch[] {
  const byId = new Map(candidates.map((c) => [c.publicId, c]));
  return output.matches
    .map((m) => {
      const c = byId.get(m.publicId);
      if (!c) return null;
      const confidence = Math.max(0, Math.min(1, m.confidence));
      return { ...c, coverage: m.coverage, confidence, rationale: m.rationale };
    })
    .filter((m): m is PriorMatch => m != null && m.confidence >= floor)
    .sort((a, b) => {
      // A full answer outranks a partial one even at slightly lower confidence:
      // "here is your record" beats "here is part of it".
      if (a.coverage !== b.coverage) return a.coverage === "full" ? -1 : 1;
      return b.confidence - a.confidence;
    });
}
