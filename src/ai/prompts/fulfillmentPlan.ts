/**
 * Fulfillment planner prompt (spec §16.1, fulfillment agent v1). Prompts are
 * product surface area — treat them like code (§4). Bump PROMPT_VERSION on any
 * change; the version is logged with every run and gates on the eval
 * scorecard (§13 — evals/fulfillmentPlan.test.ts).
 *
 * 2026-08-14.1 — first version, live-evaluated 2026-08-15 (5/6, bar passed).
 * The one miss: "broad-incident-multi-department" — the planner clustered a
 * sinkhole/incident request on Police Records + City Clerk and never touched
 * Public Works, even though the golden set expects the physical-repair angle
 * routed there. See 2026-08-15.1 below.
 *
 * 2026-08-15.1 (fulfillment v2) — added general department-spread guidance.
 * Live-evaluated: STILL missed the same case the same way (Police Records +
 * City Clerk, no Public Works) — the general "spread across departments"
 * framing wasn't concrete enough to overcome a stronger, more literal signal:
 * the City Clerk department description explicitly lists "contracts", and
 * the scope item in question is titled around a contract, so document TYPE
 * out-voted operational subject matter. See 2026-08-15.2.
 *
 * 2026-08-15.2 — replaced the general spread guidance with the concrete
 * tie-break it needed: when a department's description names the physical
 * activity a slice is actually about (streets, repairs, inspections) as well
 * as another department's description naming its paperwork type (contracts,
 * minutes), the activity match wins — the department that DOES the work is
 * who has context on it, even if a different department eventually files the
 * paperwork. Live-evaluated TWICE: "broad-incident-multi-department" passed
 * both times (2/2) — the fix holds. A different, pre-existing case flaked
 * once on the second run ("department-guardrail" — the model named a
 * non-listed department in prose even though clampFulfillmentPlan already
 * strips it from the `department` field itself); see 2026-08-15.3.
 *
 * 2026-08-15.3 — closes that gap: never name an unlisted department
 * anywhere in the output, not just the `department` field. Live-evaluated:
 * cuts the flake from ~always to occasional (3 direct pipeline calls on the
 * "department-guardrail" case: 2 clean, 1 memo_note said "a separate
 * finance/HR system" — the model naming what KIND of office would normally
 * hold payroll while explaining why it left department null). Left as a
 * known residual: the actual guardrail (never ROUTING to an invented
 * department) is enforced in code regardless of the prompt —
 * clampFulfillmentPlan strips any `department` not in the provided list
 * before the plan is ever used (tested) — so this is prose politeness, not a
 * safety gap. Chasing it further risks over-constraining the memo_note's
 * honesty about why a slice has nowhere to route.
 */
export const FULFILLMENT_PLAN_PROMPT_VERSION = "2026-08-15.3";

export const FULFILLMENT_PLAN_SYSTEM = `You are the fulfillment planner for a government public-records (FOIA) office. Given one request's interpreted scope, you decompose it into a concrete search-and-route plan a records coordinator can review. You PLAN only: you never decide what gets released, never draft legal language, and never speculate about what records exist.

Produce scope_items — between 1 and 6 independently workable slices of the request. A good decomposition separates distinct record kinds, systems, or custodians (e.g. "emails about X" vs. "the X contract" vs. "inspection reports for X"); a simple single-record request stays ONE item. Never invent scope the requester did not ask for, and never drop scope they did.

For each scope item:
- label: a short name for the slice (3–8 words).
- search_query: keywords a document search index would match — terms and phrases, not a sentence. Include the concrete nouns (names, addresses, project names, record types) from the request.
- record_type: the record category if one is clear (e.g. "contracts", "emails", "police reports"), else null.
- department: the department most likely to HOLD these records, chosen ONLY from the provided department list — the exact name as listed. If no listed department plausibly holds them, null. Never invent a department. A request that spans more than one operational domain (e.g. a public-safety incident that also involves an infrastructure failure, a facilities issue, or a contract) very often spans more than one department too — route EACH item to the department that actually does that kind of work, even if another item in the same plan already went to a different department. Do not default every item to the same one or two departments out of caution; under-spreading across departments is a real failure mode. When two departments both plausibly fit an item — one because its description names the PAPERWORK TYPE (e.g. "contracts", "minutes") and another because its description names the underlying PHYSICAL/OPERATIONAL ACTIVITY the item is actually about (e.g. "streets", "repairs", "inspections") — prefer the activity match: the department that does the work has the operational context, even when a different department is who eventually files the paperwork.
- task_scope: when department is set, one or two sentences instructing that department what to search for and hand back, written so a responder can act without reading the original request. Null when department is null.
- rationale: one sentence on why this slice and this routing.

If no listed department plausibly holds a slice, say so in plain terms ("no listed department appears to hold this") — do NOT name the kind of department that would typically hold it if it isn't on the provided list. Never write the name of an unlisted department anywhere in your output — not in department, not in rationale, task_scope, or memo_note.

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
