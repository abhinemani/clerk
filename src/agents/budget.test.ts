/** Tests for per-run budget caps (spec §16.2). */
import { describe, expect, it } from "vitest";
import {
  checkBudget,
  DEFAULT_BUDGET,
  handoffMessage,
  recordSpend,
  remainingBudget,
  ZERO_SPEND,
  type AgentBudgetLimits,
} from "./budget";

const limits: AgentBudgetLimits = { maxToolCalls: 3, maxTokens: 1000, maxWallClockMs: 5000 };

describe("checkBudget", () => {
  it("is ok with headroom", () => {
    const r = checkBudget(limits, { toolCalls: 1, tokens: 100, wallClockMs: 100 });
    expect(r.ok).toBe(true);
    expect(r.exhausted).toBeUndefined();
    expect(r.remaining).toEqual({ toolCalls: 2, tokens: 900, wallClockMs: 4900 });
  });

  it("reports tool-call exhaustion first (deterministic ordering)", () => {
    const r = checkBudget(limits, { toolCalls: 3, tokens: 2000, wallClockMs: 9999 });
    expect(r.ok).toBe(false);
    expect(r.exhausted).toBe("toolCalls");
  });

  it("reports token exhaustion when calls remain", () => {
    const r = checkBudget(limits, { toolCalls: 1, tokens: 1000, wallClockMs: 0 });
    expect(r.exhausted).toBe("tokens");
  });

  it("reports wall-clock exhaustion last", () => {
    const r = checkBudget(limits, { toolCalls: 1, tokens: 1, wallClockMs: 5000 });
    expect(r.exhausted).toBe("wallClockMs");
  });
});

describe("recordSpend", () => {
  it("accumulates tool calls and tokens, replaces wall-clock", () => {
    let spend = ZERO_SPEND;
    spend = recordSpend(spend, { toolCalls: 1, tokens: 50, wallClockMs: 200 });
    spend = recordSpend(spend, { toolCalls: 1, tokens: 30, wallClockMs: 450 });
    expect(spend).toEqual({ toolCalls: 2, tokens: 80, wallClockMs: 450 });
  });
});

describe("remainingBudget never goes negative", () => {
  it("clamps at zero", () => {
    const r = remainingBudget(limits, { toolCalls: 10, tokens: 9999, wallClockMs: 99999 });
    expect(r).toEqual({ toolCalls: 0, tokens: 0, wallClockMs: 0 });
  });
});

describe("handoffMessage", () => {
  it("names the exhausted dimension and progress", () => {
    expect(handoffMessage("tokens", 4, 9)).toContain("token budget after 4/9");
    expect(handoffMessage("toolCalls", 1, 3)).toContain("tool-call budget");
  });
});

describe("DEFAULT_BUDGET", () => {
  it("has positive caps in every dimension", () => {
    expect(DEFAULT_BUDGET.maxToolCalls).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.maxTokens).toBeGreaterThan(0);
    expect(DEFAULT_BUDGET.maxWallClockMs).toBeGreaterThan(0);
  });
});
