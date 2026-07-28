/**
 * Golden dataset for intake-triage evals (spec §13).
 *
 * "30 real-ish request texts with expected triage outputs." This is a starter
 * set — expand toward 30 as prompts evolve. Each case asserts only the stable,
 * gradeable properties of a good triage (record types present, red flags caught,
 * not-a-request detection), not exact wording, so the eval is robust to phrasing.
 */
import type { IntakeTriageOutput } from "@/ai/pipelines/intakeTriage";

export interface IntakeGoldenCase {
  id: string;
  rawText: string;
  expect: {
    /** Record types that MUST appear (case-insensitive substring match). */
    recordTypesInclude?: string[];
    requesterType?: IntakeTriageOutput["requester_type_guess"];
    /** Statutory red flags that MUST be surfaced. */
    redFlagsInclude?: string[];
    notARecordsRequest?: boolean;
    /** Rough complexity band the score should fall in. */
    complexityBand?: "low" | "medium" | "high";
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
];
