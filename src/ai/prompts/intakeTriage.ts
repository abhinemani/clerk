/**
 * Intake triage prompt (spec §6.1). Prompts are product surface area — treat
 * them like code (§4). Bump PROMPT_VERSION on any change; the version is logged
 * with every run and gates on the eval scorecard (§13).
 *
 * 2026-08-13.1 — RAG'd triage (docs/answer-first.md phase 4): the user turn
 * may now carry resolved precedents — similar past requests and how this
 * office actually handled them.
 *
 * 2026-08-14.1 — learning-loop v2 (docs/learning-loop.md): the user turn may
 * also carry ONE matched play's aggregate stats (routes, median days,
 * extension rate, exemptions) as structured calibration — numbers over the
 * whole cluster, where precedents are individual examples. Same governance
 * paragraph applies: calibration only, the raw text wins.
 *
 * ⚠ EVAL DEBT: neither 2026-08-13.1 nor this version has been through
 * `npm run eval` (no ANTHROPIC_API_KEY in the build environments); running it
 * is step one in docs/laptop-setup.md Part B.
 */
export const INTAKE_TRIAGE_PROMPT_VERSION = "2026-08-14.1";

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

The user turn may include HOW THIS OFFICE RESOLVED SIMILAR PAST REQUESTS — as individual precedents, as aggregate statistics for the matched request pattern, or both. Use them ONLY to calibrate: the office's vocabulary for record types, realistic complexity for asks like this one, and red-flag patterns that recurred (an ask type whose past cases cited exemptions or took extensions is rarely trivial). Precedents and statistics never override the request in front of you — interpreted_scope restates THIS request's text, never a precedent's scope or the pattern's topic, and a precedent that does not fit is to be ignored, not stretched. If the history and the raw text disagree, the raw text wins.

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

/** The slice of a matched play the prompt renders (structural, like
 *  PromptPrecedent — aggregate numbers where precedents are examples). */
export interface PromptPlayContext {
  topic: string;
  episodeCount: number;
  topRoute: { department: string; sharePct: number } | null;
  medianDaysToClose: number | null;
  extensionRatePct: number;
  /** Exemption labels cited in past cases of this pattern, most common first. */
  exemptions: string[];
}

export function formatPlayContext(play: PromptPlayContext): string {
  const lines = [
    `- Pattern: "${play.topic}" — ${play.episodeCount} resolved request(s)`,
  ];
  if (play.topRoute) {
    lines.push(`  Fulfilled by: ${play.topRoute.department} in ${play.topRoute.sharePct}% of cases`);
  }
  if (play.medianDaysToClose != null) lines.push(`  Median days to close: ${play.medianDaysToClose}`);
  lines.push(`  Took a statutory extension: ${play.extensionRatePct}% of cases`);
  lines.push(
    play.exemptions.length > 0
      ? `  Exemptions cited before: ${play.exemptions.join(", ")}`
      : `  Exemptions cited before: none`,
  );
  return lines.join("\n");
}

export function buildIntakeTriageUser(input: {
  rawText: string;
  precedents?: PromptPrecedent[];
  play?: PromptPlayContext;
}): string {
  const parts = [`Requester's raw request text:\n"""\n${input.rawText}\n"""`];
  if (input.precedents && input.precedents.length > 0) {
    parts.push(
      `How this office resolved similar past requests (calibration only — the raw text above governs):\n${formatPrecedents(input.precedents)}`,
    );
  }
  if (input.play) {
    parts.push(
      `Aggregate statistics for this request pattern (calibration only — the raw text above governs):\n${formatPlayContext(input.play)}`,
    );
  }
  return parts.join("\n\n");
}
