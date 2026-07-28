/**
 * Grading for intake-triage evals (spec §13). Pure scoring functions so the
 * grader itself is unit-tested; the live run (below) feeds real model output in.
 */
import type { IntakeTriageOutput } from "@/ai/pipelines/intakeTriage";
import { clampComplexity } from "@/ai/pipelines/intakeTriage";
import type { IntakeGoldenCase } from "./intakeTriage.golden";

export interface CaseScore {
  id: string;
  passed: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

function includesCI(haystack: string[], needle: string): boolean {
  const n = needle.toLowerCase();
  return haystack.some((h) => h.toLowerCase().includes(n));
}

function bandOf(score: number): "low" | "medium" | "high" {
  const s = clampComplexity(score);
  if (s < 0.34) return "low";
  if (s < 0.67) return "medium";
  return "high";
}

export function gradeCase(gold: IntakeGoldenCase, actual: IntakeTriageOutput): CaseScore {
  const checks: CaseScore["checks"] = [];

  for (const rt of gold.expect.recordTypesInclude ?? []) {
    checks.push({
      name: `record type ~ "${rt}"`,
      ok: includesCI(actual.record_types, rt),
      detail: actual.record_types.join(", "),
    });
  }
  for (const flag of gold.expect.redFlagsInclude ?? []) {
    checks.push({
      name: `red flag ~ "${flag}"`,
      ok: includesCI(actual.statutory_red_flags, flag),
      detail: actual.statutory_red_flags.join(", "),
    });
  }
  if (gold.expect.requesterType !== undefined) {
    checks.push({
      name: `requester type = ${gold.expect.requesterType}`,
      ok: actual.requester_type_guess === gold.expect.requesterType,
      detail: actual.requester_type_guess,
    });
  }
  if (gold.expect.notARecordsRequest !== undefined) {
    checks.push({
      name: `not-a-records-request = ${gold.expect.notARecordsRequest}`,
      ok: actual.likely_not_a_records_request === gold.expect.notARecordsRequest,
    });
  }
  if (gold.expect.complexityBand !== undefined) {
    checks.push({
      name: `complexity band = ${gold.expect.complexityBand}`,
      ok: bandOf(actual.complexity_score) === gold.expect.complexityBand,
      detail: `${actual.complexity_score}`,
    });
  }

  return { id: gold.id, passed: checks.every((c) => c.ok), checks };
}

export interface Scorecard {
  total: number;
  passed: number;
  passRate: number;
  cases: CaseScore[];
}

export function scorecard(scores: CaseScore[]): Scorecard {
  const passed = scores.filter((s) => s.passed).length;
  return {
    total: scores.length,
    passed,
    passRate: scores.length === 0 ? 0 : passed / scores.length,
    cases: scores,
  };
}

export function formatScorecard(card: Scorecard): string {
  const lines = [
    `Intake triage eval: ${card.passed}/${card.total} passed (${(card.passRate * 100).toFixed(0)}%)`,
  ];
  for (const c of card.cases) {
    lines.push(`  ${c.passed ? "PASS" : "FAIL"}  ${c.id}`);
    for (const check of c.checks.filter((ch) => !ch.ok)) {
      lines.push(`        ✗ ${check.name}${check.detail ? ` — got: ${check.detail}` : ""}`);
    }
  }
  return lines.join("\n");
}
