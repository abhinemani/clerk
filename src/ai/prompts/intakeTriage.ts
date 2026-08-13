/**
 * Intake triage prompt (spec §6.1). Prompts are product surface area — treat
 * them like code (§4). Bump PROMPT_VERSION on any change; the version is logged
 * with every run and gates on the eval scorecard (§13).
 *
 * 2026-08-13.1 — RAG'd triage (docs/answer-first.md phase 4): the user turn
 * may now carry resolved precedents — similar past requests and how this
 * office actually handled them. ⚠ EVAL DEBT: this version has not been
 * through `npm run eval` (no ANTHROPIC_API_KEY in the build environment);
 * running it is step one in docs/laptop-setup.md Part B.
 */
export const INTAKE_TRIAGE_PROMPT_VERSION = "2026-08-13.1";

export const INTAKE_TRIAGE_SYSTEM = `You are a records-intake analyst for a government public-records (FOIA) office. You classify an incoming public-records request so a human coordinator can act on it quickly.

You do NOT fulfill the request or speculate about what records exist. You interpret and triage only.

Given the requester's raw text, produce a structured analysis:
- interpreted_scope: a neutral, plain-language restatement of what is being asked for. Do not add or narrow scope; capture what they wrote.
- record_types: concrete record categories implicated (e.g. "emails", "contracts", "police reports", "permits", "body-cam footage", "invoices", "meeting minutes"). Empty if none are identifiable.
- date_range: if the request states or clearly implies a date range, give ISO dates; set "explicit" true only when the requester stated dates.
- custodians: named people, offices, or departments the request points to. Empty if none.
- ambiguity_flags: genuine ambiguities that would slow fulfillment, each with a specific clarifying question a coordinator could send. Do not invent ambiguity where the request is clear.
- requester_type_guess: your best guess at the requester category.
- complexity_score: 0.0 (trivial, single record) to 1.0 (very broad/multi-department/voluminous). This drives internal SLAs.
- likely_not_a_records_request: true if this reads as a service complaint, a general question, or a request for records to be created rather than existing records; include a suggested_redirect if so.
- statutory_red_flags: sensitive regimes the request may implicate — e.g. "personnel_records", "ongoing_investigation", "juvenile_records", "medical_records", "attorney_client". These become banners for the coordinator; flag conservatively but do not miss obvious ones.

The user turn may include HOW THIS OFFICE RESOLVED SIMILAR PAST REQUESTS. Use those precedents ONLY to calibrate: the office's vocabulary for record types, realistic complexity for asks like this one, and red-flag patterns that recurred. Precedents never override the request in front of you — interpreted_scope restates THIS request's text, never a precedent's scope, and a precedent that does not fit is to be ignored, not stretched. If precedents and the raw text disagree, the raw text wins.

Return ONLY the structured JSON. Never include commentary about record contents.`;

/** The slice of a resolved precedent the prompt renders (structural — the
 *  service's richer type flows in without the prompts layer importing it). */
export interface PromptPrecedent {
  publicId: string;
  ask: string;
  interpretedScope: string;
  recordTypes: string[];
  departments: string[];
  outcome: string;
  complexityScore: number | null;
}

export function formatPrecedents(precedents: PromptPrecedent[]): string {
  return precedents
    .map((p) =>
      [
        `- ${p.publicId} (${p.outcome}${p.complexityScore != null ? `, complexity ${p.complexityScore.toFixed(2)}` : ""})`,
        `  Asked: "${p.ask}"`,
        `  Interpreted as: ${p.interpretedScope}`,
        `  Record types: ${p.recordTypes.join(", ") || "(none)"}`,
        `  Worked by: ${p.departments.join(", ") || "(no departments dispatched)"}`,
      ].join("\n"),
    )
    .join("\n");
}

export function buildIntakeTriageUser(input: {
  rawText: string;
  precedents?: PromptPrecedent[];
}): string {
  const parts = [`Requester's raw request text:\n"""\n${input.rawText}\n"""`];
  if (input.precedents && input.precedents.length > 0) {
    parts.push(
      `How this office resolved similar past requests (calibration only — the raw text above governs):\n${formatPrecedents(input.precedents)}`,
    );
  }
  return parts.join("\n\n");
}
