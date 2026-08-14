/**
 * Consistency auditor (agentic-horizon B2) — the third Phase-5 agent.
 *
 * Weekly, per agency: read the review/exemption decision log the office
 * already writes and flag records of the same type treated inconsistently
 * across requests ("officer names redacted under privacy in PR-104 but
 * released in PR-131"). Inconsistency is what loses appeals; this agent finds
 * it while the office still remembers why.
 *
 * Read-only Tier 1 through and through: it flags (`flag_for_review`) and
 * reports (`status_memo`) — it never touches a decision, and its allowlist
 * has no hole where a decision-changing action would go. Like the deadline
 * and disclosure agents it runs on pure logic — no model, no API key —
 * through the real harness, so every step passes allowlist → tier → budget
 * and lands in the append-only audit log.
 */
import type { AgentPlanStep } from "@/db/schema";
import {
  findInconsistencies,
  type ConsistencyFinding,
  type DecisionRecord,
} from "@/domain/consistencyAudit";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface ConsistencyAuditResult {
  findings: ConsistencyFinding[];
  digest: string;
  outcome: string;
  events: AgentActionEvent[];
  /** Final run state — persisted by callers that steer runs (§16.2). */
  run: AgentRunState;
}

function step(index: number, name: string, input: Record<string, unknown>, isTool = false): AgentPlanStep {
  return isTool
    ? { index, description: name, status: "pending", tool: name, input }
    : { index, description: name, status: "pending", action: name, input };
}

function cap(name: string, fn: (input: Record<string, unknown>) => unknown): Capability {
  return {
    name: name as never,
    async execute(input) {
      return { output: fn(input), tokens: 0 };
    },
  };
}

function buildDigest(now: Date, decisionCount: number, findings: ConsistencyFinding[]): string {
  const lines = [
    `Consistency audit — ${now.toISOString().slice(0, 10)}`,
    `${decisionCount} review decision(s) examined · ${findings.length} inconsistency finding(s)`,
    "",
  ];
  if (findings.length === 0) lines.push("No cross-request inconsistencies found.");
  for (const f of findings) lines.push(`  • ${f.summary}`);
  if (findings.length > 0) {
    lines.push(
      "",
      "A divergence is not necessarily an error — but it should have a reason. Reconcile or note the distinction before an appeal asks.",
    );
  }
  return lines.join("\n");
}

/** Run the weekly consistency audit as a real agent execution. */
export async function runConsistencyAudit(input: {
  decisions: DecisionRecord[];
  now: Date;
  agencyId?: string;
  policy?: AgencyActionPolicy;
  /** Persisted-run id; defaults to the ephemeral "consistency-audit". */
  runId?: string;
  /** Persist hook, called after every step (§16.2 resumability). */
  persist?: (run: AgentRunState) => Promise<void> | void;
}): Promise<ConsistencyAuditResult> {
  const findings = findInconsistencies(input.decisions);
  const digest = buildDigest(input.now, input.decisions.length, findings);

  // Deterministic capability implementations (no model) — each reads only its
  // step's input, the resumability rule every persisted agent keeps.
  const registry = new MapCapabilityRegistry([
    cap("read_decision_log", (i) => ({
      decisions: i.decisions ?? 0,
      requests: i.requests ?? 0,
    })),
    cap("flag_for_review", (i) => ({
      flagged: String(i.recordType ?? "record type"),
      kind: i.kind,
    })),
    cap("status_memo", (i) => ({ digest: i.digest ?? "" })),
  ]);

  // Plan: read the log → one flag per finding → digest memo.
  const steps: AgentPlanStep[] = [];
  let idx = 0;
  steps.push(
    step(
      idx++,
      "read_decision_log",
      {
        decisions: input.decisions.length,
        requests: new Set(input.decisions.map((d) => d.requestPublicId)).size,
      },
      true,
    ),
  );
  for (const f of findings) {
    steps.push(
      step(idx++, "flag_for_review", {
        kind: f.kind,
        recordType: f.recordType,
        summary: f.summary,
        releasedIn: f.releasedIn,
        restrictedIn: f.restrictedIn,
        exemptions: f.exemptions,
      }),
    );
  }
  steps.push(step(idx++, "status_memo", { digest }));

  const run: AgentRunState = {
    id: input.runId ?? "consistency-audit",
    agencyId: input.agencyId ?? "agency",
    status: "planning",
    plan: { goal: "Weekly consistency audit", cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("consistency_auditor"),
    policy: input.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
    persist: input.persist,
  });

  return { findings, digest, outcome: res.outcome, events, run };
}
