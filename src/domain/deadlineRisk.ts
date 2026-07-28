/**
 * Deadline-risk scoring (spec §8 queue banding, §16.1 deadline agent).
 *
 * The queue is sorted by deadline risk and color-banded (overdue / due ≤3 days /
 * on track). The deadline agent computes the same risk to prioritize its nightly
 * sweep: "days remaining × outstanding tasks × complexity." We combine urgency
 * (inverse of days remaining), outstanding task load, and complexity into one
 * sortable 0–1 score, plus a discrete band for the UI. Pure and testable.
 */
import { utcDateFloor } from "@/statute/businessDays";

export type RiskBand = "overdue" | "due_soon" | "on_track";

export interface DeadlineRiskInput {
  /** Effective due date (extended if applicable). */
  dueAt: Date;
  /** Reference instant (injected for testability). */
  now: Date;
  /** Open department tasks not yet completed. */
  outstandingTasks: number;
  /** Intake complexity score 0–1 (§6.1). */
  complexityScore: number;
  /** Days-out at/under which the "due_soon" band applies. Default 3 (§8). */
  dueSoonThresholdDays?: number;
}

export interface DeadlineRisk {
  band: RiskBand;
  /** Calendar days until due; negative if overdue. */
  daysRemaining: number;
  /** Sortable overall risk, 0 (low) to 1 (high). */
  score: number;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

const MS_PER_DAY = 86_400_000;

// Weights: urgency dominates, then task load, then intrinsic complexity.
const W_URGENCY = 0.5;
const W_TASKS = 0.3;
const W_COMPLEXITY = 0.2;

// Task load saturates at this many outstanding tasks.
const TASK_SATURATION = 5;
// Urgency ramps up across this horizon (days) as the deadline approaches.
const URGENCY_HORIZON_DAYS = 14;

export function deadlineRisk(input: DeadlineRiskInput): DeadlineRisk {
  const threshold = input.dueSoonThresholdDays ?? 3;
  const due = utcDateFloor(input.dueAt).getTime();
  const now = utcDateFloor(input.now).getTime();
  const daysRemaining = Math.round((due - now) / MS_PER_DAY);

  const band: RiskBand =
    daysRemaining < 0 ? "overdue" : daysRemaining <= threshold ? "due_soon" : "on_track";

  // Urgency: 1.0 when overdue, ramping from 0 (far out) to 1 (due today).
  const urgency =
    daysRemaining < 0 ? 1 : clamp01(1 - daysRemaining / URGENCY_HORIZON_DAYS);
  const taskFactor = clamp01(input.outstandingTasks / TASK_SATURATION);
  const complexity = clamp01(input.complexityScore);

  const score = clamp01(
    W_URGENCY * urgency + W_TASKS * taskFactor + W_COMPLEXITY * complexity,
  );

  return { band, daysRemaining, score };
}

/** Order requests most-at-risk first (overdue on top), then by score, then soonest due. */
export function byRiskDesc(a: DeadlineRisk, b: DeadlineRisk): number {
  return b.score - a.score || a.daysRemaining - b.daysRemaining;
}
