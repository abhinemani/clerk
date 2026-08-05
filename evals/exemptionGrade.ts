/**
 * Recall-first grading for the exemption pass (spec §13).
 *
 * The asymmetry is the whole point: a MISSED exemption ships someone's SSN to
 * a requester (unrecoverable, reportable, sometimes actionable), while an
 * over-flag costs a reviewer one click in the studio. So recall gates and
 * precision only reports. Pure functions — the grader itself is unit-tested,
 * and the live run feeds real model output through the same code.
 */
import type { ExemptionPassOutput } from "@/ai/pipelines/exemptionPass";
import { exemptionFindingsToRedactions } from "@/ai/pipelines/exemptionPass";
import type { ExemptionGoldenCase } from "./exemptionPass.golden";

export interface ExemptionCaseScore {
  id: string;
  /** Recall gate: every mustCatch label was covered by some flagged span. */
  passed: boolean;
  recall: number;
  /** Reported, never gating — see the module note. */
  precision: number | null;
  missed: string[];
  falseFlags: string[];
  findingCount: number;
}

/**
 * A label counts as caught when a flagged span's covered text contains it, or
 * the label contains the span — models legitimately flag "Dana" of "Dana
 * Whitfield" or the whole line; either way the value gets blacked out.
 */
function covers(spanText: string, label: string): boolean {
  const s = spanText.toLowerCase().trim();
  const l = label.toLowerCase().trim();
  if (!s || !l) return false;
  return s.includes(l) || l.includes(s);
}

export function gradeExemptionCase(
  gold: ExemptionGoldenCase,
  actual: ExemptionPassOutput,
): ExemptionCaseScore {
  // Grade the SPANS the studio would actually render, not the raw model text —
  // a finding whose phrase doesn't locate in the document redacts nothing.
  const spans = exemptionFindingsToRedactions(gold.lines, actual);
  const spanTexts = spans.map((s) => gold.lines[s.line]!.slice(s.startCol, s.endCol));

  const missed = gold.expect.mustCatch.filter((label) => !spanTexts.some((t) => covers(t, label)));
  const recall =
    gold.expect.mustCatch.length === 0 ? 1 : (gold.expect.mustCatch.length - missed.length) / gold.expect.mustCatch.length;

  const falseFlags = (gold.expect.mustNotFlag ?? []).filter((decoy) =>
    spanTexts.some((t) => covers(t, decoy)),
  );

  // Precision proxy: of the spans produced, how many touch a mustCatch label?
  // Undefined when nothing was flagged (nothing to be precise about).
  const useful = spanTexts.filter((t) => gold.expect.mustCatch.some((label) => covers(t, label))).length;
  const precision = spanTexts.length === 0 ? null : useful / spanTexts.length;

  // The control case inverts the gate: flagging a fully public document is the
  // failure there, because it teaches staff to rubber-stamp "accept all".
  const passed = gold.expect.expectNoFindings ? spans.length === 0 : missed.length === 0;

  return { id: gold.id, passed, recall, precision, missed, falseFlags, findingCount: spans.length };
}

export interface ExemptionScorecard {
  cases: ExemptionCaseScore[];
  passed: number;
  total: number;
  /** Macro-average recall across cases — the headline number. */
  meanRecall: number;
  meanPrecision: number | null;
  totalMissed: number;
  totalFalseFlags: number;
}

export function exemptionScorecard(cases: ExemptionCaseScore[]): ExemptionScorecard {
  const withPrecision = cases.filter((c) => c.precision != null);
  return {
    cases,
    passed: cases.filter((c) => c.passed).length,
    total: cases.length,
    meanRecall: cases.length === 0 ? 0 : cases.reduce((a, c) => a + c.recall, 0) / cases.length,
    meanPrecision:
      withPrecision.length === 0
        ? null
        : withPrecision.reduce((a, c) => a + (c.precision ?? 0), 0) / withPrecision.length,
    totalMissed: cases.reduce((a, c) => a + c.missed.length, 0),
    totalFalseFlags: cases.reduce((a, c) => a + c.falseFlags.length, 0),
  };
}

export function formatExemptionScorecard(s: ExemptionScorecard): string {
  const pct = (n: number | null) => (n == null ? "n/a" : `${Math.round(n * 100)}%`);
  const lines = [
    "",
    "Exemption-pass scorecard (recall-first)",
    "=======================================",
    `  Cases passed:      ${s.passed}/${s.total}`,
    `  Mean recall:       ${pct(s.meanRecall)}   ← the number that gates`,
    `  Mean precision:    ${pct(s.meanPrecision)}   (reported only; over-flagging is one dismissal)`,
    `  Missed labels:     ${s.totalMissed}${s.totalMissed > 0 ? "   ← REVIEW: these would have shipped" : ""}`,
    `  Decoys flagged:    ${s.totalFalseFlags}`,
    "",
    ...s.cases.map((c) => {
      const head = `  ${c.passed ? "PASS" : "FAIL"}  ${c.id}  recall=${pct(c.recall)} precision=${pct(c.precision)} findings=${c.findingCount}`;
      const detail = [
        c.missed.length > 0 ? `        missed: ${c.missed.join(" · ")}` : "",
        c.falseFlags.length > 0 ? `        over-flagged: ${c.falseFlags.join(" · ")}` : "",
      ].filter(Boolean);
      return [head, ...detail].join("\n");
    }),
  ];
  return lines.join("\n");
}
