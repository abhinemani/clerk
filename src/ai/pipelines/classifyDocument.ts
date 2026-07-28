/**
 * Auto-classification on ingest (spec §6.5 / §9.3). Every incoming document gets
 * an AI pass — record type, department, suggested metadata, and a public/internal
 * classification — so by the time a human looks, it's already organized and
 * pre-flagged. Pairs with the deterministic sensitivity pre-scan in normalize().
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { PipelineDefinition } from "../runPipeline";

export const classifyDocumentSchema = z
  .object({
    recordType: z.string(),
    department: z.string().nullable(),
    classification: z.enum(["public", "internal"]),
    suggestedMetadata: z.array(z.object({ key: z.string(), value: z.string() }).strict()),
    sensitivityNote: z.string().nullable(),
  })
  .strict();

export type ClassifyDocumentOutput = z.infer<typeof classifyDocumentSchema>;

export interface ClassifyDocumentInput {
  filename?: string;
  text: string;
  departments: string[];
}

const SYSTEM = `You classify a government document that just arrived in the records system, so it can be organized before a human reviews it.

Output:
- recordType: a concise record type (e.g. "meeting minutes", "contract", "police report", "invoice", "permit", "email").
- department: which of the provided departments most likely owns it, or null.
- classification: "public" if it is ordinarily releasable, "internal" if it plausibly contains exempt/sensitive material (personnel, investigation, deliberative, attorney-client). When in doubt, choose "internal" — a human can release it, but you should never mark a sensitive record public.
- suggestedMetadata: key/value pairs worth indexing (e.g. vendor, amount, meeting_date, contract_start).
- sensitivityNote: a short note if it may contain PII or exempt content, else null.

Return ONLY the structured JSON.`;

export const classifyDocumentPipeline: PipelineDefinition<ClassifyDocumentInput, ClassifyDocumentOutput> = {
  name: "classify_document",
  promptVersion: "2026-07-27.1",
  schema: classifyDocumentSchema,
  jsonSchema: zodToJsonSchema(classifyDocumentSchema, { name: "classify_document", target: "openApi3" }) as Record<
    string,
    unknown
  >,
  buildPrompt: (input) => ({
    system: SYSTEM,
    user: [
      input.filename ? `Filename: ${input.filename}` : "",
      `Departments: ${input.departments.join(", ")}`,
      ``,
      `Document text:\n"""\n${input.text.slice(0, 6000)}\n"""`,
    ]
      .filter(Boolean)
      .join("\n"),
  }),
};
