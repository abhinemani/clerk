/**
 * Per-run budget caps (spec §16.2).
 *
 * "Budget caps per run (tool calls, tokens, wall-clock) with graceful 'here's
 *  where I got to' handoff on exhaustion."
 *
 * Pure functions over explicit spend/limit values — no clock reads here, so the
 * logic is deterministic and testable. The orchestrator passes elapsed wall-clock
 * in explicitly (it owns the one impure `Date.now()` read).
 */
import type { AgentBudgetLimits, AgentBudgetSpend } from "@/db/schema";

export type { AgentBudgetLimits, AgentBudgetSpend };

export type BudgetDimension = "toolCalls" | "tokens" | "wallClockMs";

export const ZERO_SPEND: AgentBudgetSpend = { toolCalls: 0, tokens: 0, wallClockMs: 0 };

/** Sensible default caps; agencies/agent definitions can override. */
export const DEFAULT_BUDGET: AgentBudgetLimits = {
  maxToolCalls: 40,
  maxTokens: 200_000,
  maxWallClockMs: 10 * 60_000, // 10 minutes
};

export interface BudgetCheck {
  ok: boolean;
  /** Which dimension is exhausted (first one hit), if any. */
  exhausted?: BudgetDimension;
  remaining: AgentBudgetSpend;
}

/** Remaining headroom in each dimension (never negative). */
export function remainingBudget(
  limits: AgentBudgetLimits,
  spend: AgentBudgetSpend,
): AgentBudgetSpend {
  return {
    toolCalls: Math.max(0, limits.maxToolCalls - spend.toolCalls),
    tokens: Math.max(0, limits.maxTokens - spend.tokens),
    wallClockMs: Math.max(0, limits.maxWallClockMs - spend.wallClockMs),
  };
}

/**
 * Is there budget left to take another step? Checks the dimensions in a fixed
 * order so the reported `exhausted` dimension is deterministic.
 */
export function checkBudget(
  limits: AgentBudgetLimits,
  spend: AgentBudgetSpend,
): BudgetCheck {
  const remaining = remainingBudget(limits, spend);
  let exhausted: BudgetDimension | undefined;
  if (spend.toolCalls >= limits.maxToolCalls) exhausted = "toolCalls";
  else if (spend.tokens >= limits.maxTokens) exhausted = "tokens";
  else if (spend.wallClockMs >= limits.maxWallClockMs) exhausted = "wallClockMs";
  return { ok: exhausted === undefined, exhausted, remaining };
}

/** Fold one step's usage into the running spend (returns a new object). */
export function recordSpend(
  spend: AgentBudgetSpend,
  delta: { toolCalls?: number; tokens?: number; wallClockMs?: number },
): AgentBudgetSpend {
  return {
    toolCalls: spend.toolCalls + (delta.toolCalls ?? 0),
    tokens: spend.tokens + (delta.tokens ?? 0),
    wallClockMs: delta.wallClockMs ?? spend.wallClockMs,
  };
}

/** A human-readable handoff line for an exhausted run (§16.2). */
export function handoffMessage(
  dimension: BudgetDimension,
  completedSteps: number,
  totalSteps: number,
): string {
  const label: Record<BudgetDimension, string> = {
    toolCalls: "tool-call",
    tokens: "token",
    wallClockMs: "wall-clock",
  };
  return `Reached the ${label[dimension]} budget after ${completedSteps}/${totalSteps} planned steps. Pausing for handoff — resume or redirect to continue.`;
}
