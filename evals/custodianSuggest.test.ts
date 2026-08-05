/**
 * Custodian-suggestion eval runner (inter-agency referral, phase 2). Same
 * two-part shape as the exemption evals: the grader is unit-tested
 * deterministically and always runs; the live scored run only fires with
 * ANTHROPIC_API_KEY under `npm run eval`.
 *
 * Per CLAUDE.md, changing src/ai/prompts/custodianSuggest.ts requires running
 * this and reporting the scorecard diff.
 */
import { describe, expect, it } from "vitest";
import type { CustodianSuggestOutput } from "@/ai/pipelines/custodianSuggest";
import { custodianSuggestPipeline } from "@/ai/pipelines/custodianSuggest";
import { runPipeline } from "@/ai/runPipeline";
import { AnthropicModelClient } from "@/ai/modelClient";
import { CUSTODIAN_GOLDEN } from "./custodianSuggest.golden";
import { custodianScorecard, formatCustodianScorecard, gradeCustodianCase } from "./custodianGrade";

const ours = CUSTODIAN_GOLDEN.find((c) => c.id === "ours-police-report")!;
const referSchool = CUSTODIAN_GOLDEN.find((c) => c.id === "refer-student-discipline")!;
const referDmv = CUSTODIAN_GOLDEN.find((c) => c.id === "refer-drivers-license")!;

const keep: CustodianSuggestOutput = { belongsToThisAgency: true, suggestions: [] };
const suggest = (id: string, confidence = 0.9): CustodianSuggestOutput => ({
  belongsToThisAgency: false,
  suggestions: [{ directoryEntryId: id, confidence, rationale: "test" }],
});

describe("custodian grader", () => {
  it("passes an 'ours' case that draws no proposal", () => {
    const score = gradeCustodianCase(ours, keep);
    expect(score.passed).toBe(true);
    expect(score.falseReferral).toBe(false);
  });

  it("FAILS an 'ours' case that draws a referral — precision is the gate", () => {
    const score = gradeCustodianCase(ours, suggest("dir-court"));
    expect(score.passed).toBe(false);
    expect(score.falseReferral).toBe(true);
    expect(score.proposedName).toBe("Marlin County Superior Court");
  });

  it("an 'ours' verdict with a stray suggestion still passes — the reducer suppresses it", () => {
    const contradictory = { ...suggest("dir-school"), belongsToThisAgency: true };
    expect(gradeCustodianCase(ours, contradictory).passed).toBe(true);
  });

  it("a low-confidence suggestion on an 'ours' case passes — it never reaches a coordinator", () => {
    expect(gradeCustodianCase(ours, suggest("dir-school", 0.3)).falseReferral).toBe(false);
  });

  it("passes a referral case whose top proposal is the expected body", () => {
    const score = gradeCustodianCase(referSchool, suggest("dir-school"));
    expect(score.passed).toBe(true);
    expect(score.missed).toBe(false);
  });

  it("FAILS a referral case pointing at the wrong body — a bounce to nowhere", () => {
    const score = gradeCustodianCase(referSchool, suggest("dir-dmv"));
    expect(score.passed).toBe(false);
    expect(score.wrongTarget).toBe(true);
  });

  it("FAILS a missed mustCatch referral, but only reports a missed soft one", () => {
    expect(gradeCustodianCase(referSchool, keep).passed).toBe(false);
    const soft = gradeCustodianCase(referDmv, keep);
    expect(soft.passed).toBe(true);
    expect(soft.missed).toBe(true);
  });

  it("summarizes a scorecard and formats it", () => {
    const scores = [
      gradeCustodianCase(ours, keep),
      gradeCustodianCase(referSchool, suggest("dir-school")),
      gradeCustodianCase(referDmv, keep),
    ];
    const card = custodianScorecard(
      CUSTODIAN_GOLDEN.filter((g) => scores.some((s) => s.id === g.id)),
      scores,
    );
    expect(card.passed).toBe(3);
    expect(card.falseReferrals).toBe(0);
    expect(card.caught).toBe(1);
    expect(card.referralCases).toBe(2);
    expect(formatCustodianScorecard(card)).toContain("False referrals:   0");
  });
});

const live = process.env.RUN_LIVE_EVALS && process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

live("custodian suggestion — live scored run", () => {
  it(
    "scores the golden set (precision gates; prints the scorecard)",
    async () => {
      const modelClient = new AnthropicModelClient(process.env.ANTHROPIC_API_KEY!);
      // Independent requests — run concurrently.
      const scores = await Promise.all(
        CUSTODIAN_GOLDEN.map(async (gold) => {
          const { output } = await runPipeline(custodianSuggestPipeline, gold.input, { modelClient });
          return gradeCustodianCase(gold, output);
        }),
      );
      const card = custodianScorecard(CUSTODIAN_GOLDEN, scores);
      // eslint-disable-next-line no-console
      console.log(formatCustodianScorecard(card));
      // A false referral is the failure mode this eval exists to catch.
      expect(
        card.falseReferrals,
        `false referrals: ${card.cases.filter((c) => c.falseReferral).map((c) => `${c.id} → ${c.proposedName}`).join(", ")}`,
      ).toBe(0);
      expect(card.wrongTargets).toBe(0);
      // And the unambiguous referrals must land, or the feature is dead weight.
      expect(card.passed).toBe(card.total);
    },
    180_000,
  );
});
