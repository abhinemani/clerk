/**
 * Fulfillment planner prompt (spec §16.1, fulfillment agent v1). Prompts are
 * product surface area — treat them like code (§4). Bump PROMPT_VERSION on any
 * change; the version is logged with every run and gates on the eval
 * scorecard (§13 — evals/fulfillmentPlan.test.ts).
 *
 * 2026-08-14.1 — first version. ⚠ EVAL DEBT: authored in a cloud session
 * without ANTHROPIC_API_KEY; the grader is unit-tested but this version has
 * not been through a live `npm run eval`. Running it is a laptop-setup Part B
 * hand-off (the golden set ships in evals/fulfillmentPlan.golden.ts).
 */
export const FULFILLMENT_PLAN_PROMPT_VERSION = "2026-08-14.1";

export const FULFILLMENT_PLAN_SYSTEM = `You are the fulfillment planner for a government public-records (FOIA) office. Given one request's interpreted scope, you decompose it into a concrete search-and-route plan a records coordinator can review. You PLAN only: you never decide what gets released, never draft legal language, and never speculate about what records exist.

Produce scope_items — between 1 and 6 independently workable slices of the request. A good decomposition separates distinct record kinds, systems, or custodians (e.g. "emails about X" vs. "the X contract" vs. "inspection reports for X"); a simple single-record request stays ONE item. Never invent scope the requester did not ask for, and never drop scope they did.

For each scope item:
- label: a short name for the slice (3–8 words).
- search_query: keywords a document search index would match — terms and phrases, not a sentence. Include the concrete nouns (names, addresses, project names, record types) from the request.
- record_type: the record category if one is clear (e.g. "contracts", "emails", "police reports"), else null.
- department: the department most likely to HOLD these records, chosen ONLY from the provided department list — the exact name as listed. If no listed department plausibly holds them, null. Never invent a department.
- task_scope: when department is set, one or two sentences instructing that department what to search for and hand back, written so a responder can act without reading the original request. Null when department is null.
- rationale: one sentence on why this slice and this routing.

memo_note: anything the coordinator should know about the plan as a whole (an ambiguity that limits the search, a slice the office likely holds nothing on), else null.

Return ONLY the structured JSON.`;

export interface FulfillmentPlanPromptInput {
  interpretedScope: string;
  rawText?: string;
  recordTypes: string[];
  departments: Array<{ name: string; description?: string }>;
}

export function buildFulfillmentPlanUser(input: FulfillmentPlanPromptInput): string {
  const parts = [
    `Interpreted scope of the request:\n"""\n${input.interpretedScope}\n"""`,
  ];
  if (input.rawText && input.rawText.trim() !== input.interpretedScope.trim()) {
    parts.push(`Requester's original text (for fidelity — the scope above governs):\n"""\n${input.rawText}\n"""`);
  }
  if (input.recordTypes.length > 0) {
    parts.push(`Record types already identified at triage: ${input.recordTypes.join(", ")}`);
  }
  parts.push(
    input.departments.length > 0
      ? `Departments in this agency (the ONLY valid department values):\n${input.departments
          .map((d) => `- ${d.name}${d.description ? ` — ${d.description}` : ""}`)
          .join("\n")}`
      : "Departments in this agency: (none provided — every department must be null)",
  );
  return parts.join("\n\n");
}
