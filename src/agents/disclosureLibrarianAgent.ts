/**
 * Proactive-disclosure librarian (agentic-horizon B1) — the first Phase-5
 * agent to RUN (gate released by the owner 2026-08-13).
 *
 * Nightly, per agency: mine the demand signals the platform already collects
 * (resolved requests, deflection-log queries, archive misses) for repeated
 * asks, and turn each pattern into a publication PROPOSAL. Pure risk-free
 * plan: every step is Tier 1. The agent never publishes — the classification
 * flip that makes a record public is a named human's act (invariant 9), and
 * the proposal card only points a human at the demand.
 *
 * Like the deadline agent, this runs on pure logic — no model, no API key —
 * through the real run harness, so every step passes the allowlist → tier →
 * budget guardrails and lands in the append-only audit log.
 */
import type { AgentPlanStep } from "@/db/schema";
import {
  mineDemandPatterns,
  type DemandPattern,
  type DemandSignal,
} from "@/domain/demandPatterns";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface DisclosureSweepResult {
  patterns: DemandPattern[];
  digest: string;
  outcome: string;
  events: AgentActionEvent[];
}

function step(index: number, action: string, input: Record<string, unknown>): AgentPlanStep {
  return { index, description: action, status: "pending", action, input };
}

function cap(name: string, fn: (input: Record<string, unknown>) => unknown): Capability {
  return {
    name: name as never,
    async execute(input) {
      return { output: fn(input), tokens: 0 };
    },
  };
}

function describePattern(p: DemandPattern): string {
  const parts = [
    p.requests > 0 ? `${p.requests} request(s)` : null,
    p.queries > 0 ? `${p.queries} search(es)` : null,
    p.misses > 0 ? `${p.misses} unanswered search(es)` : null,
  ].filter(Boolean);
  return `${parts.join(" + ")} about “${p.topic}” — consider publishing the series`;
}

function buildDigest(now: Date, signalCount: number, patterns: DemandPattern[]): string {
  const lines = [
    `Disclosure sweep — ${now.toISOString().slice(0, 10)}`,
    `${signalCount} demand signal(s) in window · ${patterns.length} pattern(s) found`,
    "",
  ];
  if (patterns.length === 0) lines.push("No repeated unmet demand this window.");
  for (const p of patterns) lines.push(`  • ${describePattern(p)}`);
  return lines.join("\n");
}

/** Run the nightly disclosure sweep as a real agent execution. */
export async function runDisclosureSweep(input: {
  signals: DemandSignal[];
  now: Date;
  agencyId?: string;
  policy?: AgencyActionPolicy;
  windowDays?: number;
  minCount?: number;
}): Promise<DisclosureSweepResult> {
  const patterns = mineDemandPatterns(input.signals, {
    now: input.now,
    windowDays: input.windowDays,
    minCount: input.minCount,
  });
  const digest = buildDigest(input.now, input.signals.length, patterns);

  // Deterministic capability implementations (no model).
  const registry = new MapCapabilityRegistry([
    cap("read_demand_signals", () => ({
      signals: input.signals.length,
      patterns: patterns.length,
    })),
    cap("propose_publication_candidate", (i) => ({
      proposed: String(i.topic ?? "pattern"),
      keywords: i.keywords,
    })),
    cap("status_memo", () => ({ digest })),
  ]);

  // Plan: read signals → one proposal per pattern → digest memo.
  const steps: AgentPlanStep[] = [];
  let idx = 0;
  steps.push(step(idx++, "read_demand_signals", {}));
  for (const p of patterns) {
    steps.push(
      step(idx++, "propose_publication_candidate", {
        topic: p.topic,
        keywords: p.keywords,
        total: p.total,
        refs: p.refs,
      }),
    );
  }
  steps.push(step(idx++, "status_memo", {}));

  const run: AgentRunState = {
    id: "disclosure-sweep",
    agencyId: input.agencyId ?? "agency",
    status: "planning",
    plan: { goal: "Nightly proactive-disclosure sweep", cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("disclosure_librarian"),
    policy: input.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  return { patterns, digest, outcome: res.outcome, events };
}
