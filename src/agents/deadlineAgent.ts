/**
 * Deadline agent (spec §16.1) — the first agent that actually RUNS.
 *
 * A nightly, cron-driven sweep of the open queue: compute deadline risk, draft
 * nudges for at-risk requests, pre-draft extension notices before deadlines blow,
 * and produce the coordinator's morning digest. It runs on pure risk logic — no
 * model, no API key — executing through the real run harness so every step goes
 * through the allowlist → tier → budget guardrails and lands in the audit log.
 */
import type { AgentPlanStep } from "@/db/schema";
import { deadlineRisk, type RiskBand } from "@/domain/deadlineRisk";
import { DEFAULT_ACTION_POLICY, type AgencyActionPolicy } from "./actionTiers";
import { DEFAULT_BUDGET, ZERO_SPEND } from "./budget";
import { getAgentDefinition } from "./definitions";
import { runAgent, type AgentActionEvent, type AgentRunState } from "./runHarness";
import { MapCapabilityRegistry, type Capability } from "./tools";

export interface QueueItem {
  publicId: string;
  dueAt: Date;
  outstandingTasks: number;
  complexityScore: number;
}

export interface AtRisk {
  publicId: string;
  band: RiskBand;
  daysRemaining: number;
  recommendation: string;
}

export interface DeadlineSweepResult {
  digest: string;
  atRisk: AtRisk[];
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

function buildDigest(now: Date, total: number, atRisk: AtRisk[]): string {
  const overdue = atRisk.filter((a) => a.band === "overdue");
  const dueSoon = atRisk.filter((a) => a.band === "due_soon");
  const lines = [
    `Morning digest — ${now.toISOString().slice(0, 10)}`,
    `${total} open · ${overdue.length} overdue · ${dueSoon.length} due soon`,
    "",
  ];
  if (atRisk.length === 0) lines.push("Nothing at risk today. 🎉");
  for (const a of atRisk.slice(0, 8)) {
    const tag = a.band === "overdue" ? "OVERDUE" : "DUE SOON";
    lines.push(`  [${tag}] ${a.publicId} — ${a.recommendation}`);
  }
  return lines.join("\n");
}

/** Run the nightly deadline sweep as a real agent execution. */
export async function runDeadlineSweep(input: {
  queue: QueueItem[];
  now: Date;
  agencyId?: string;
  policy?: AgencyActionPolicy;
}): Promise<DeadlineSweepResult> {
  const risks = input.queue
    .map((q) => ({
      q,
      r: deadlineRisk({ dueAt: q.dueAt, now: input.now, outstandingTasks: q.outstandingTasks, complexityScore: q.complexityScore }),
    }))
    .sort((a, b) => b.r.score - a.r.score);

  const atRisk: AtRisk[] = risks
    .filter((x) => x.r.band !== "on_track")
    .map(({ q, r }) => ({
      publicId: q.publicId,
      band: r.band,
      daysRemaining: r.daysRemaining,
      recommendation:
        r.band === "overdue"
          ? "Overdue — send a closure or extension notice today"
          : q.outstandingTasks > 0
            ? `Due soon — nudge ${q.outstandingTasks} outstanding department task(s)`
            : "Due soon — confirm the records are ready to release",
    }));

  const digest = buildDigest(input.now, input.queue.length, atRisk);

  // Deterministic capability implementations (no model).
  const registry = new MapCapabilityRegistry([
    cap("read_queue", () => ({ total: input.queue.length, atRisk: atRisk.length })),
    cap("compute_deadline_risk", () => ({ risks: atRisk })),
    cap("internal_nudge", (i) => ({ drafted: `In-app nudge for ${i.publicId ?? "request"}` })),
    cap("create_extension_draft", (i) => ({ draft: `Extension notice draft for ${i.publicId ?? "request"}` })),
    cap("status_memo", () => ({ digest })),
  ]);

  // Build the plan: read → assess → per-risk draft → morning memo.
  const steps: AgentPlanStep[] = [];
  let idx = 0;
  steps.push(step(idx++, "read_queue", {}));
  steps.push(step(idx++, "compute_deadline_risk", {}));
  for (const a of atRisk.slice(0, 5)) {
    steps.push(
      a.band === "overdue"
        ? step(idx++, "create_extension_draft", { publicId: a.publicId })
        : step(idx++, "internal_nudge", { publicId: a.publicId }),
    );
  }
  steps.push(step(idx++, "status_memo", {}));

  const run: AgentRunState = {
    id: "deadline-sweep",
    agencyId: input.agencyId ?? "agency",
    status: "planning",
    plan: { goal: "Nightly deadline sweep", cursor: 0, steps },
    budgetLimits: { ...DEFAULT_BUDGET },
    budgetSpend: { ...ZERO_SPEND },
  };

  const events: AgentActionEvent[] = [];
  const res = await runAgent(run, {
    definition: getAgentDefinition("deadline"),
    policy: input.policy ?? DEFAULT_ACTION_POLICY,
    registry,
    emit: (e) => void events.push(e),
  });

  return { digest, atRisk, outcome: res.outcome, events };
}
