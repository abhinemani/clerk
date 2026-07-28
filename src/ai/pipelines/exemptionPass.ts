/**
 * LLM exemption pass (spec §6.5 step 2) — the crown-jewel half of redaction.
 *
 * Page-by-page, identify passages implicating the agency's configured exemptions
 * → text span → suggested exemption citation → confidence → rationale. Maps the
 * returned phrases to character-range redactions the studio can render. Pairs
 * with the deterministic PII pass (§6.5 step 1).
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";
import type { RedactionSpan } from "@/domain/redaction";
import {
  EXEMPTION_PASS_PROMPT_VERSION,
  EXEMPTION_PASS_SYSTEM,
  buildExemptionPassUser,
} from "../prompts/exemptionPass";

export const exemptionPassSchema = z
  .object({
    findings: z.array(
      z
        .object({
          line: z.number(),
          phrase: z.string(),
          exemption: z.string(),
          confidence: z.number(),
          rationale: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type ExemptionPassOutput = z.infer<typeof exemptionPassSchema>;

export interface ExemptionPassInput {
  lines: string[];
  exemptions: string[];
}

export const exemptionPassPipeline: PipelineDefinition<ExemptionPassInput, ExemptionPassOutput> = {
  name: "exemption_pass",
  promptVersion: EXEMPTION_PASS_PROMPT_VERSION,
  maxTokens: 2048,
  schema: exemptionPassSchema,
  jsonSchema: zodToJsonSchema(exemptionPassSchema, { name: "exemption_pass", target: "openApi3" }) as Record<
    string,
    unknown
  >,
  buildPrompt: (input) => ({
    system: EXEMPTION_PASS_SYSTEM,
    user: buildExemptionPassUser(input),
  }),
};

export interface SuggestedExemptionRedaction extends RedactionSpan {
  confidence: number;
  rationale: string;
  source: "ai_exemption";
}

/**
 * Map the model's phrase-level findings to character-range redactions by locating
 * each verbatim phrase on its line. Findings whose phrase can't be located are
 * dropped (the model must return exact substrings).
 */
export function exemptionFindingsToRedactions(
  lines: string[],
  output: ExemptionPassOutput,
): SuggestedExemptionRedaction[] {
  const out: SuggestedExemptionRedaction[] = [];
  for (const f of output.findings) {
    const line = lines[f.line];
    if (line == null) continue;
    const startCol = line.indexOf(f.phrase);
    if (startCol < 0) continue;
    out.push({
      line: f.line,
      startCol,
      endCol: startCol + f.phrase.length,
      reason: f.exemption,
      confidence: f.confidence,
      rationale: f.rationale,
      source: "ai_exemption",
    });
  }
  return out;
}
