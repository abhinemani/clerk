/**
 * Precision-first grading for the custodian suggestion (inter-agency referral,
 * phase 2). The deliberate inverse of `exemptionGrade.ts` — see the golden
 * file's header for why the asymmetry flips here.
 *
 * Grades the PROPOSALS a coordinator would actually see (via
 * `custodianProposals`), not the raw model output — a suggestion the reducer
 * filters out never reaches a human, so it can neither bounce a resident nor
 * help one.
 */
import type { CustodianSuggestOutput } from "@/ai/pipelines/custodianSuggest";
import { custodianProposals } from "@/ai/pipelines/custodianSuggest";
import type { CustodianGoldenCase } from "./custodianSuggest.golden";

export interface CustodianCaseScore {
  id: string;
  passed: boolean;
  /** Proposed a referral for a request the agency holds — the gating failure. */
  falseReferral: boolean;
  /** Referral case where the top proposal names the wrong body — also gates. */
  wrongTarget: boolean;
  /** Referral case with no proposal — reported (recall), gates only on mustCatch. */
  missed: boolean;
  /** What the coordinator would have seen, for the printed card. */
  proposedName: string | null;
}

export function gradeCustodianCase(
  gold: CustodianGoldenCase,
  actual: CustodianSuggestOutput,
): CustodianCaseScore {
  const proposals = custodianProposals(actual, gold.input.directory);
  const top = proposals[0] ?? null;

  if (gold.expect.belongsToThisAgency) {
    // Ours: ANY surviving proposal bounces a resident who came to the right place.
    return {
      id: gold.id,
      passed: top == null,
      falseReferral: top != null,
      wrongTarget: false,
      missed: false,
      proposedName: top?.name ?? null,
    };
  }

  // Theirs: the right target must lead. No proposal = missed (gates only when
  // the case is marked unambiguous); wrong body leading = a bounce to nowhere.
  const wrongTarget = top != null && top.directoryEntryId !== gold.expect.expectedEntryId;
  const missed = top == null;
  return {
    id: gold.id,
    passed: !wrongTarget && !(missed && gold.expect.mustCatch),
    falseReferral: false,
    wrongTarget,
    missed,
    proposedName: top?.name ?? null,
  };
}

export interface CustodianScorecard {
  cases: CustodianCaseScore[];
  passed: number;
  total: number;
  /** Zero or the eval fails — the headline number. */
  falseReferrals: number;
  wrongTargets: number;
  /** Of the referral cases, how many drew the right proposal (recall — reported). */
  caught: number;
  referralCases: number;
}

export function custodianScorecard(
  golds: CustodianGoldenCase[],
  cases: CustodianCaseScore[],
): CustodianScorecard {
  const referral = golds.filter((g) => !g.expect.belongsToThisAgency);
  const caught = cases.filter((c) => {
    const gold = golds.find((g) => g.id === c.id);
    return gold && !gold.expect.belongsToThisAgency && !c.missed && !c.wrongTarget;
  }).length;
  return {
    cases,
    passed: cases.filter((c) => c.passed).length,
    total: cases.length,
    falseReferrals: cases.filter((c) => c.falseReferral).length,
    wrongTargets: cases.filter((c) => c.wrongTarget).length,
    caught,
    referralCases: referral.length,
  };
}

export function formatCustodianScorecard(s: CustodianScorecard): string {
  const lines = [
    "",
    "Custodian-suggestion scorecard (precision-first)",
    "================================================",
    `  Cases passed:      ${s.passed}/${s.total}`,
    `  False referrals:   ${s.falseReferrals}${s.falseReferrals > 0 ? "   ← REVIEW: these bounce residents who came to the right place" : "   ← the number that gates"}`,
    `  Wrong targets:     ${s.wrongTargets}`,
    `  Referrals caught:  ${s.caught}/${s.referralCases}   (recall — reported; only unambiguous cases gate)`,
    "",
    ...s.cases.map((c) => {
      const outcome = c.falseReferral
        ? `FALSE REFERRAL → ${c.proposedName}`
        : c.wrongTarget
          ? `wrong target → ${c.proposedName}`
          : c.missed
            ? "missed (no proposal)"
            : c.proposedName
              ? `→ ${c.proposedName}`
              : "kept (no proposal)";
      return `  ${c.passed ? "PASS" : "FAIL"}  ${c.id}  ${outcome}`;
    }),
  ];
  return lines.join("\n");
}
