/**
 * Intake-triage eval runner (spec §13).
 *
 * `npm run eval` runs this. It has two parts:
 *   1. Deterministic unit tests of the grader itself (always run).
 *   2. A live scored run against the golden set — only when ANTHROPIC_API_KEY is
 *      set, so CI without a key stays green while `npm run eval` with a key
 *      prints a real scorecard. Prompts don't change without the scorecard (§13).
 */
import { describe, expect, it } from "vitest";
import type { IntakeTriageOutput } from "@/ai/pipelines/intakeTriage";
import { intakeTriagePipeline } from "@/ai/pipelines/intakeTriage";
import { runPipeline } from "@/ai/runPipeline";
import { AnthropicModelClient } from "@/ai/modelClient";
import { INTAKE_GOLDEN } from "./intakeTriage.golden";
import { formatScorecard, gradeCase, scorecard } from "./grade";

const sample: IntakeTriageOutput = {
  interpreted_scope: "The current janitorial services contract for City Hall.",
  record_types: ["contracts"],
  date_range: { start: null, end: null, explicit: false },
  custodians: ["City Hall"],
  ambiguity_flags: [],
  requester_type_guess: "individual",
  complexity_score: 0.1,
  likely_not_a_records_request: false,
  suggested_redirect: null,
  statutory_red_flags: [],
};

describe("grader", () => {
  it("passes a case whose expectations are met", () => {
    const gold = INTAKE_GOLDEN.find((c) => c.id === "contract-simple")!;
    const score = gradeCase(gold, sample);
    expect(score.passed).toBe(true);
  });

  it("fails a case with a missed record type or red flag", () => {
    const gold = INTAKE_GOLDEN.find((c) => c.id === "police-report-personnel")!;
    const score = gradeCase(gold, sample); // sample has no personnel red flag
    expect(score.passed).toBe(false);
    expect(score.checks.some((c) => c.name.includes("personnel") && !c.ok)).toBe(true);
  });

  it("bands complexity correctly", () => {
    const broad = INTAKE_GOLDEN.find((c) => c.id === "broad-emails")!;
    const highComplexity = { ...sample, record_types: ["emails"], complexity_score: 0.9 };
    expect(gradeCase(broad, highComplexity).passed).toBe(true);
  });

  it("summarizes a scorecard", () => {
    const card = scorecard([gradeCase(INTAKE_GOLDEN[0]!, sample)]);
    expect(card.total).toBe(1);
    expect(formatScorecard(card)).toContain("Intake triage eval");
  });
});

// Live run — skipped unless a real API key is present.
const live = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
live("intake triage — live scored run", () => {
  it(
    "meets the pass-rate bar on the golden set",
    async () => {
      const client = new AnthropicModelClient();
      const scores = [];
      for (const gold of INTAKE_GOLDEN) {
        const res = await runPipeline(intakeTriagePipeline, { rawText: gold.rawText }, {
          modelClient: client,
        });
        scores.push(gradeCase(gold, res.output));
      }
      const card = scorecard(scores);
      // eslint-disable-next-line no-console
      console.log("\n" + formatScorecard(card) + "\n");
      expect(card.passRate).toBeGreaterThanOrEqual(0.8);
    },
    120_000,
  );
});
