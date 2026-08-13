/**
 * Golden dataset for intake-triage evals (spec §13).
 *
 * "30 real-ish request texts with expected triage outputs." This is a starter
 * set — expand toward 30 as prompts evolve. Each case asserts only the stable,
 * gradeable properties of a good triage (record types present, red flags caught,
 * not-a-request detection), not exact wording, so the eval is robust to phrasing.
 */
import type { IntakeTriageOutput } from "@/ai/pipelines/intakeTriage";
import type { PromptPrecedent } from "@/ai/prompts/intakeTriage";

export interface IntakeGoldenCase {
  id: string;
  rawText: string;
  /** RAG'd triage (phase 4): resolved precedents passed with the request. */
  precedents?: PromptPrecedent[];
  expect: {
    /** Record types that MUST appear (case-insensitive substring match). */
    recordTypesInclude?: string[];
    requesterType?: IntakeTriageOutput["requester_type_guess"];
    /** Statutory red flags that MUST be surfaced. */
    redFlagsInclude?: string[];
    notARecordsRequest?: boolean;
    /** Rough complexity band the score should fall in. */
    complexityBand?: "low" | "medium" | "high";
    /** Terms that must NOT leak from precedents into interpreted_scope. */
    scopeExcludes?: string[];
  };
}

export const INTAKE_GOLDEN: IntakeGoldenCase[] = [
  {
    id: "contract-simple",
    rawText: "Please send me the current janitorial services contract for City Hall.",
    expect: { recordTypesInclude: ["contract"], complexityBand: "low" },
  },
  {
    id: "police-report-personnel",
    rawText:
      "I want all internal affairs files and disciplinary records for Officer J. Smith from 2020 to now.",
    expect: {
      recordTypesInclude: ["personnel", "record"],
      redFlagsInclude: ["personnel_records"],
      complexityBand: "medium",
    },
  },
  {
    id: "juvenile",
    rawText: "Copies of the juvenile arrest records from the incident at Lincoln High last month.",
    expect: { redFlagsInclude: ["juvenile_records"] },
  },
  {
    id: "broad-emails",
    rawText:
      "Every email sent or received by anyone in the Public Works department mentioning 'zoning' over the last five years.",
    expect: { recordTypesInclude: ["email"], complexityBand: "high" },
  },
  {
    id: "not-a-request-complaint",
    rawText: "My trash hasn't been picked up in three weeks and nobody will call me back. Fix it.",
    expect: { notARecordsRequest: true },
  },
  {
    id: "ongoing-investigation",
    rawText:
      "All records related to the open homicide investigation of the downtown shooting, including detective notes.",
    expect: { redFlagsInclude: ["ongoing_investigation"] },
  },

  // --- RAG'd triage (phase 4): precedents calibrate, never contaminate ----
  {
    // A vague ask; the precedent shows this office files these as sweeping
    // SCHEDULES handled at low complexity — calibration the raw text alone
    // can't provide.
    id: "rag-calibrates-vocabulary",
    rawText: "when do the sweepers come to my street (Riverbend)?",
    precedents: [
      {
        publicId: "PR-2026-00101",
        ask: "When are the street sweeping days for the Riverbend neighborhood this year?",
        interpretedScope: "Street sweeping schedule for Riverbend, current year.",
        recordTypes: ["schedules"],
        departments: ["Public Works"],
        outcome: "closed",
        complexityScore: 0.15,
      },
    ],
    expect: { recordTypesInclude: ["schedule"], complexityBand: "low" },
  },
  {
    // The guardrail case: a precedent about police overtime must not bleed
    // into a request about janitorial contracts — scope restates THIS ask.
    id: "rag-precedent-does-not-contaminate",
    rawText: "Please send the current janitorial services contract for the library.",
    precedents: [
      {
        publicId: "PR-2026-00102",
        ask: "Police department overtime records for 2025",
        interpretedScope: "Police overtime and payroll records, calendar 2025.",
        recordTypes: ["payroll records"],
        departments: ["Police Records"],
        outcome: "closed",
        complexityScore: 0.5,
      },
    ],
    expect: {
      recordTypesInclude: ["contract"],
      complexityBand: "low",
      scopeExcludes: ["overtime", "police", "payroll"],
    },
  },
];
