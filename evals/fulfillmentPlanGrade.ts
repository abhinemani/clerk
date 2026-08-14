/**
 * Grading for fulfillment-plan evals (spec §13). Pure scoring functions so the
 * grader itself is unit-tested; the live run feeds real model output in.
 */
import type { FulfillmentPlanOutput } from "@/ai/pipelines/fulfillmentPlan";
import type { FulfillmentGoldenCase } from "./fulfillmentPlan.golden";

export interface PlanCaseScore {
  id: string;
  passed: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

const ci = (s: string) => s.toLowerCase();

function planText(plan: FulfillmentPlanOutput): string {
  return plan.scope_items
    .flatMap((i) => [i.label, i.search_query, i.record_type ?? "", i.task_scope ?? "", i.rationale])
    .concat(plan.memo_note ?? "")
    .join(" \n ");
}

export function gradePlanCase(
  gold: FulfillmentGoldenCase,
  actual: FulfillmentPlanOutput,
): PlanCaseScore {
  const checks: PlanCaseScore["checks"] = [];
  const items = actual.scope_items;
  const queries = items.map((i) => i.search_query);
  const [min, max] = gold.expect.itemBand;

  checks.push({
    name: `item count in [${min}, ${max}]`,
    ok: items.length >= min && items.length <= max,
    detail: `${items.length} item(s)`,
  });

  for (const term of gold.expect.queriesInclude ?? []) {
    checks.push({
      name: `some search_query ~ "${term}"`,
      ok: queries.some((q) => ci(q).includes(ci(term))),
      detail: queries.join(" | "),
    });
  }

  // Structural guardrail, checked on EVERY case: departments only from the
  // provided list (exact name), never invented.
  const validDepts = new Set(gold.input.departments.map((d) => ci(d.name)));
  const assigned = items.map((i) => i.department).filter((d): d is string => d != null);
  checks.push({
    name: "departments only from the provided list",
    ok: assigned.every((d) => validDepts.has(ci(d))),
    detail: assigned.join(", ") || "(none assigned)",
  });

  for (const dept of gold.expect.departmentsExpected ?? []) {
    checks.push({
      name: `some item routed to "${dept}"`,
      ok: assigned.some((d) => ci(d) === ci(dept)),
      detail: assigned.join(", ") || "(none assigned)",
    });
  }

  if (gold.expect.noDepartments) {
    checks.push({
      name: "no departments assigned",
      ok: assigned.length === 0,
      detail: assigned.join(", ") || "(none)",
    });
  }

  // Routed items must carry an actionable task_scope for the responder.
  checks.push({
    name: "every routed item has a task_scope",
    ok: items.every((i) => i.department == null || (i.task_scope ?? "").trim().length > 0),
  });

  const text = planText(actual);
  for (const term of gold.expect.planExcludes ?? []) {
    checks.push({
      name: `plan excludes "${term}"`,
      ok: !ci(text).includes(ci(term)),
    });
  }

  return { id: gold.id, passed: checks.every((c) => c.ok), checks };
}

export interface PlanScorecard {
  total: number;
  passed: number;
  passRate: number;
  cases: PlanCaseScore[];
}

export function planScorecard(scores: PlanCaseScore[]): PlanScorecard {
  const passed = scores.filter((s) => s.passed).length;
  return {
    total: scores.length,
    passed,
    passRate: scores.length === 0 ? 0 : passed / scores.length,
    cases: scores,
  };
}

export function formatPlanScorecard(card: PlanScorecard): string {
  const lines = [
    `Fulfillment plan eval: ${card.passed}/${card.total} passed (${(card.passRate * 100).toFixed(0)}%)`,
  ];
  for (const c of card.cases) {
    lines.push(`  ${c.passed ? "PASS" : "FAIL"}  ${c.id}`);
    for (const check of c.checks.filter((ch) => !ch.ok)) {
      lines.push(`        ✗ ${check.name}${check.detail ? ` — got: ${check.detail}` : ""}`);
    }
  }
  return lines.join("\n");
}
