/**
 * Custodian-suggestion pipeline (inter-agency referral, phase 2).
 *
 * Given a triaged request and the agency's referral directory, propose the body
 * that actually holds the records — so a resident who wrote to the wrong office
 * learns that in hours instead of after the full statutory clock.
 *
 * The output is a PROPOSAL. Nothing here refers anything: referral reaches a
 * requester, so it stays a named human's act (invariant 4).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import {
  CUSTODIAN_SUGGEST_PROMPT_VERSION,
  CUSTODIAN_SUGGEST_SYSTEM,
  buildCustodianSuggestUser,
} from "../prompts/custodianSuggest";

export const custodianSuggestSchema = z
  .object({
    /** True = we plausibly hold some of these records; do not refer. */
    belongsToThisAgency: z.boolean(),
    suggestions: z.array(
      z
        .object({
          directoryEntryId: z.string(),
          // Confidence 0–1. No numeric bounds in the JSON schema (structured
          // outputs reject min/max); custodianProposals clamps on read.
          confidence: z.number(),
          rationale: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type CustodianSuggestOutput = z.infer<typeof custodianSuggestSchema>;

export interface CustodianSuggestInput {
  interpretedScope: string;
  recordTypes: string[];
  /** Who we are — "not ours" is meaningless without an "ours". */
  agencyName: string;
  directory: Array<{ id: string; name: string; recordTypes: string[]; notes?: string }>;
}

export const custodianSuggestPipeline: PipelineDefinition<
  CustodianSuggestInput,
  CustodianSuggestOutput
> = {
  name: "custodian_suggest",
  promptVersion: CUSTODIAN_SUGGEST_PROMPT_VERSION,
  schema: custodianSuggestSchema,
  jsonSchema: zodToJsonSchema(custodianSuggestSchema, {
    name: "custodian_suggest",
    target: "openApi3",
  }) as Record<string, unknown>,
  buildPrompt: (input) => ({
    system: CUSTODIAN_SUGGEST_SYSTEM,
    user: buildCustodianSuggestUser(input),
  }),
};

export interface CustodianProposal {
  directoryEntryId: string;
  name: string;
  confidence: number;
  rationale: string;
}

/**
 * The proposals a coordinator should actually see — the same reduction the
 * grader scores, so the eval measures what ships.
 *
 * Three filters, all one-directional (they can only remove a referral, never
 * add one):
 *   - "belongs to us" wins outright. A model that says both "ours" and "refer
 *     to them" is confused, and the safe reading of confusion is: keep it.
 *   - Unknown ids are dropped. A hallucinated directory entry can't be referred
 *     to, and a stale id would point at a deleted agency.
 *   - Below `minConfidence` is dropped. A guess isn't worth interrupting a
 *     coordinator over, and every card shown lowers the odds the next one is
 *     read.
 */
export function custodianProposals(
  output: CustodianSuggestOutput,
  directory: Array<{ id: string; name: string }>,
  minConfidence = 0.5,
): CustodianProposal[] {
  if (output.belongsToThisAgency) return [];
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const nameById = new Map(directory.map((d) => [d.id, d.name]));
  return output.suggestions
    .filter((s) => nameById.has(s.directoryEntryId) && clamp01(s.confidence) >= minConfidence)
    .map((s) => ({
      directoryEntryId: s.directoryEntryId,
      name: nameById.get(s.directoryEntryId)!,
      confidence: clamp01(s.confidence),
      rationale: s.rationale,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}
