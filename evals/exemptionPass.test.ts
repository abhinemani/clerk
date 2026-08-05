/**
 * Exemption-pass eval runner (spec §13). Same two-part shape as the intake
 * evals: the grader is unit-tested deterministically and always runs; the
 * live scored run only fires with ANTHROPIC_API_KEY, so CI without a key
 * stays green while `npm run eval` with one prints a real scorecard.
 *
 * Per CLAUDE.md, changing src/ai/prompts/exemptionPass.ts requires running
 * this and reporting the scorecard diff.
 */
import { describe, expect, it } from "vitest";
import type { ExemptionPassOutput } from "@/ai/pipelines/exemptionPass";
import { exemptionPassPipeline } from "@/ai/pipelines/exemptionPass";
import { runPipeline } from "@/ai/runPipeline";
import { AnthropicModelClient } from "@/ai/modelClient";
import { EXEMPTION_GOLDEN } from "./exemptionPass.golden";
import { exemptionScorecard, formatExemptionScorecard, gradeExemptionCase } from "./exemptionGrade";

const incident = EXEMPTION_GOLDEN.find((c) => c.id === "incident-report-pii")!;
const benign = EXEMPTION_GOLDEN.find((c) => c.id === "benign-minutes")!;

/** Build model output that flags the given phrases on their real lines. */
function outputFor(lines: string[], phrases: string[]): ExemptionPassOutput {
  return {
    findings: phrases.map((phrase) => ({
      line: lines.findIndex((l) => l.includes(phrase)),
      phrase,
      exemption: "Personal privacy (Cal. Gov. Code § 7927.700)",
      confidence: 0.9,
      rationale: "test",
    })),
  };
}

describe("exemption grader", () => {
  it("passes when every must-catch label is covered by a span", () => {
    const score = gradeExemptionCase(incident, outputFor(incident.lines, incident.expect.mustCatch));
    expect(score.passed).toBe(true);
    expect(score.recall).toBe(1);
    expect(score.missed).toEqual([]);
  });

  it("FAILS on a single missed label — recall is the gate", () => {
    const partial = incident.expect.mustCatch.slice(1); // drop the reporting party's name
    const score = gradeExemptionCase(incident, outputFor(incident.lines, partial));
    expect(score.passed).toBe(false);
    expect(score.missed).toEqual(["Dana Whitfield"]);
    expect(score.recall).toBeCloseTo(0.8, 5);
  });

  it("counts a wider span as a catch — redacting the whole line still hides the value", () => {
    const wholeLine = incident.lines.find((l) => l.includes("Dana Whitfield"))!;
    const score = gradeExemptionCase(incident, outputFor(incident.lines, [wholeLine]));
    expect(score.missed).not.toContain("Dana Whitfield");
  });

  it("ignores findings whose phrase isn't in the document — they redact nothing", () => {
    const score = gradeExemptionCase(incident, {
      findings: [
        { line: 4, phrase: "a phrase that does not appear", exemption: "x", confidence: 0.9, rationale: "y" },
      ],
    });
    expect(score.findingCount).toBe(0);
    expect(score.passed).toBe(false); // nothing caught
  });

  it("reports decoy over-flags as precision, not as a hard failure", () => {
    const score = gradeExemptionCase(
      incident,
      outputFor(incident.lines, [...incident.expect.mustCatch, "Sgt. M. Alvarez"]),
    );
    expect(score.passed).toBe(true); // recall intact — still passes
    expect(score.falseFlags).toContain("Sgt. M. Alvarez");
    expect(score.precision).toBeLessThan(1);
  });

  it("inverts the gate on the control case: flagging public minutes fails", () => {
    expect(gradeExemptionCase(benign, { findings: [] }).passed).toBe(true);
    const overzealous = gradeExemptionCase(benign, outputFor(benign.lines, ["Mayor L. Ortiz"]));
    expect(overzealous.passed).toBe(false);
  });

  it("summarizes a scorecard and formats it", () => {
    const scores = [
      gradeExemptionCase(incident, outputFor(incident.lines, incident.expect.mustCatch)),
      gradeExemptionCase(benign, { findings: [] }),
    ];
    const card = exemptionScorecard(scores);
    expect(card.passed).toBe(2);
    expect(card.total).toBe(2);
    expect(card.meanRecall).toBe(1);
    expect(formatExemptionScorecard(card)).toContain("Cases passed:      2/2");
  });
});

const live = process.env.RUN_LIVE_EVALS && process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("exemption pass — live scored run", () => {
  it(
    "scores the golden set (recall gates; prints the scorecard)",
    async () => {
      const modelClient = new AnthropicModelClient(process.env.ANTHROPIC_API_KEY!);
      // Independent documents — run concurrently; the wall clock is one
      // document, not five.
      const scores = await Promise.all(
        EXEMPTION_GOLDEN.map(async (gold) => {
          const { output } = await runPipeline(
            exemptionPassPipeline,
            { lines: gold.lines, exemptions: gold.exemptions },
            { modelClient },
          );
          return gradeExemptionCase(gold, output);
        }),
      );
      const card = exemptionScorecard(scores);
      // eslint-disable-next-line no-console
      console.log(formatExemptionScorecard(card));
      // A missed exemption is the failure mode this whole eval exists to catch.
      expect(card.totalMissed, `missed labels: ${card.cases.flatMap((c) => c.missed).join(", ")}`).toBe(0);
    },
    180_000,
  );
});
