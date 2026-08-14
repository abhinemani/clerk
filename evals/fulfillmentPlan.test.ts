/**
 * Fulfillment-plan eval runner (spec §13, §16.1 — the scope-decomposition
 * golden set gating the fulfillment agent's planner).
 *
 * `npm run eval` runs this. Two parts, intake-triage idiom:
 *   1. Deterministic unit tests of the grader itself (always run).
 *   2. A live scored run against the golden set — only when ANTHROPIC_API_KEY
 *      is set, so CI without a key stays green while `npm run eval` with a key
 *      prints a real scorecard. Prompts don't change without the scorecard.
 */
import { describe, expect, it } from "vitest";
import type { FulfillmentPlanOutput } from "@/ai/pipelines/fulfillmentPlan";
import { clampFulfillmentPlan, fulfillmentPlanPipeline } from "@/ai/pipelines/fulfillmentPlan";
import { runPipeline } from "@/ai/runPipeline";
import { AnthropicModelClient } from "@/ai/modelClient";
import { FULFILLMENT_GOLDEN } from "./fulfillmentPlan.golden";
import { formatPlanScorecard, gradePlanCase, planScorecard } from "./fulfillmentPlanGrade";

const goodSimplePlan: FulfillmentPlanOutput = {
  scope_items: [
    {
      label: "Janitorial services contract",
      search_query: "janitorial services contract City Hall",
      record_type: "contracts",
      department: "City Clerk",
      task_scope: "Locate the current janitorial services contract for City Hall and provide the executed copy.",
      rationale: "Contracts live with the Clerk.",
    },
  ],
  memo_note: null,
};

describe("fulfillment plan grader", () => {
  it("passes a case whose expectations are met", () => {
    const gold = FULFILLMENT_GOLDEN.find((c) => c.id === "simple-single-record")!;
    expect(gradePlanCase(gold, goodSimplePlan).passed).toBe(true);
  });

  it("fails a plan that invents a department off the provided list", () => {
    const gold = FULFILLMENT_GOLDEN.find((c) => c.id === "simple-single-record")!;
    const invented = {
      ...goodSimplePlan,
      scope_items: [{ ...goodSimplePlan.scope_items[0]!, department: "Facilities Management" }],
    };
    const score = gradePlanCase(gold, invented);
    expect(score.passed).toBe(false);
    expect(score.checks.some((c) => c.name.includes("provided list") && !c.ok)).toBe(true);
  });

  it("fails a decomposition that misses a part of a multi-part request", () => {
    const gold = FULFILLMENT_GOLDEN.find((c) => c.id === "multi-part-project")!;
    const missing = {
      scope_items: [
        {
          label: "Riverside project emails",
          search_query: "Acme Development Riverside emails",
          record_type: "emails",
          department: "City Clerk",
          task_scope: "Search staff email for Acme Development correspondence about Riverside.",
          rationale: "Email slice.",
        },
        {
          label: "Riverside permits",
          search_query: "Riverside building permit",
          record_type: "permits",
          department: "Public Works",
          task_scope: "Pull the Riverside project's building permits.",
          rationale: "Permit slice.",
        },
      ],
      memo_note: null,
    };
    const score = gradePlanCase(gold, missing); // no "inspection" query
    expect(score.passed).toBe(false);
    expect(score.checks.some((c) => c.name.includes("inspection") && !c.ok)).toBe(true);
  });

  it("fails a routed item that ships without a task_scope", () => {
    const gold = FULFILLMENT_GOLDEN.find((c) => c.id === "simple-single-record")!;
    const bare = {
      ...goodSimplePlan,
      scope_items: [{ ...goodSimplePlan.scope_items[0]!, task_scope: null }],
    };
    const score = gradePlanCase(gold, bare);
    expect(score.checks.some((c) => c.name.includes("task_scope") && !c.ok)).toBe(true);
  });

  it("enforces the no-departments case", () => {
    const gold = FULFILLMENT_GOLDEN.find((c) => c.id === "no-departments-provided")!;
    const routed: FulfillmentPlanOutput = {
      scope_items: [
        {
          label: "Planning Commission minutes",
          search_query: "Planning Commission minutes March 2026",
          record_type: "meeting minutes",
          department: "City Clerk",
          task_scope: "Pull the March 2026 Planning Commission minutes.",
          rationale: "Minutes live with the Clerk.",
        },
      ],
      memo_note: null,
    };
    expect(gradePlanCase(gold, routed).passed).toBe(false);
    // clampFulfillmentPlan enforces the same guardrail in code: with no
    // departments provided, the routing is stripped before use.
    const clamped = clampFulfillmentPlan(routed, []);
    expect(clamped.scope_items[0]!.department).toBeNull();
    expect(gradePlanCase(gold, clamped).passed).toBe(true);
  });

  it("summarizes a scorecard", () => {
    const gold = FULFILLMENT_GOLDEN.find((c) => c.id === "simple-single-record")!;
    const card = planScorecard([gradePlanCase(gold, goodSimplePlan)]);
    expect(card.total).toBe(1);
    expect(formatPlanScorecard(card)).toContain("Fulfillment plan eval");
  });
});

// Live run — skipped unless a real API key is present.
const live = process.env.RUN_LIVE_EVALS && process.env.ANTHROPIC_API_KEY ? describe : describe.skip;
live("fulfillment plan — live scored run", () => {
  it(
    "meets the pass-rate bar on the golden set",
    async () => {
      const client = new AnthropicModelClient();
      const scores = await Promise.all(
        FULFILLMENT_GOLDEN.map(async (gold) => {
          const res = await runPipeline(fulfillmentPlanPipeline, gold.input, {
            modelClient: client,
          });
          // Grade the CLAMPED plan — what the service actually consumes.
          return gradePlanCase(gold, clampFulfillmentPlan(res.output, gold.input.departments));
        }),
      );
      const card = planScorecard(scores);
      // eslint-disable-next-line no-console
      console.log("\n" + formatPlanScorecard(card) + "\n");
      expect(card.passRate).toBeGreaterThanOrEqual(0.8);
    },
    180_000,
  );
});
