/**
 * Deadline agent (spec §16.1) — the first agent that actually RUNS.
 *
 * A nightly, cron-driven sweep of the open queue: compute deadline risk, draft
 * nudges for at-risk requests, pre-draft extension notices before deadlines blow,
 * and produce the coordinator's morning digest. It runs on pure risk logic — no
 * model, no API key — executing through the real run harness so every step goes
 * through the allowlist → tier → budget guardrails and lands in the audit log.
 *
 * Since the steering surface (/app/agents) exists, the sweep can also PLAN the
 * spec's Tier-2 move: `send_custodian_nudge_email` for overdue department
 * tasks. Under the default policy that step parks the run at a human
 * checkpoint; a named staff member approves it from the UI and the resumed run
 * sends the email (per-agency Tier-2 opt-in would make it autonomous, §16.3).
 *
 * Resumability rule: every capability here reads ONLY its step's `input`
 * (embedded at plan time) plus injected deps — never a closure over sweep-time
 * state — so a persisted plan can resume in a later process.
 */
import type { AgentPlanStep } from "@/db/schema";
import { deadlineRisk, type RiskBand } from "@/domain/deadlineRisk";
import type { ServiceDeps } from "@/services/deps";
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

/** An overdue/at-risk department task worth a Tier-2 email nudge. */
export interface CustodianNudgeTarget {
  publicId: string;
  taskId: string;
  departmentEmail: string;
  departmentName?: string;
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
  /** Final run state — persisted by callers that steer runs (§16.2). */
  run: AgentRunState;
}

function step(index: number, action: string, input: Record<string, unknown>): AgentPlanStep {
  return { index, description: action, status: "pending", action, input };
}

function cap(
  name: string,
  fn: (input: Record<string, unknown>) => Promise<unknown> | unknown,
): Capability {
  return {
    name: name as never,
    async execute(input) {
      return { output: await fn(input), tokens: 0 };
    },
  };
}

/**
 * The deadline agent's capability implementations — a pure function of each
 * step's input (plus deps for the one real send), so a resumed run behaves
 * identically to a fresh one. Exported for the steering surface's resume path.
 */
export function deadlineCapabilityRegistry(
  agencyId: string,
  deps?: ServiceDeps,
): MapCapabilityRegistry {
  return new MapCapabilityRegistry([
    cap("read_queue", (i) => ({ total: i.total ?? 0, atRisk: i.atRisk ?? 0 })),
    cap("compute_deadline_risk", (i) => ({ risks: i.risks ?? [] })),
    cap("internal_nudge", (i) => ({ drafted: `In-app nudge for ${i.publicId ?? "request"}` })),
    cap("create_extension_draft", (i) => ({
      draft: `Extension notice draft for ${i.publicId ?? "request"}`,
    })),
    cap("send_custodian_nudge_email", async (i) => {
      if (deps && typeof i.taskId === "string" && typeof i.departmentEmail === "string") {
        const { remindResponder } = await import("@/services/taskService");
        await remindResponder(deps, {
          agencyId,
          taskId: i.taskId,
          departmentEmail: i.departmentEmail,
          departmentName: typeof i.departmentName === "string" ? i.departmentName : undefined,
        });
        return { sent: true, to: i.departmentEmail };
      }
      // No deps injected (pure test run) — record the intent, send nothing.
      return { sent: false, to: i.departmentEmail ?? null };
    }),
    cap("status_memo", (i) => ({ digest: i.digest ?? "" })),
  ]);
}

function buildDigest(
  now: Date,
  total: number,
  atRisk: AtRisk[],
  nudgeTargets: CustodianNudgeTarget[],
): string {
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
  if (nudgeTargets.length > 0) {
    lines.push(
      "",
      `${nudgeTargets.length} custodian email nudge(s) planned — Tier 2, awaiting approval on /app/agents unless auto-send is opted in.`,
    );
  }
  return lines.join("\n");
}

/** Run the nightly deadline sweep as a real agent execution. */
export async function runDeadlineSweep(input: {
  queue: QueueItem[];
  now: Date;
  agencyId?: string;
  policy?: AgencyActionPolicy;
  /** Overdue department tasks to email about (Tier 2 — parks without opt-in). */
  nudgeTargets?: CustodianNudgeTarget[];
  /** When present, nudge sends are real (remindResponder + delivery event). */
  deps?: ServiceDeps;
  /** Persisted-run id; defaults to the ephemeral "deadline-sweep". */
  runId?: string;
  /** Persist hook, called after every step (§16.2 resumability). */
  persist?: (run: AgentRunState) => Promise<void> | void;
}): Promise<DeadlineSweepResult> {
  const nudgeTargets = input.nudgeTargets ?? [];
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

  const digest = buildDigest(input.now, input.queue.length, atRisk, nudgeTargets);
  const agencyId = input.agencyId ?? "agency";
  const registry = deadlineCapabilityRegistry(agencyId, input.deps);

  // Build the plan: read → assess → per-risk draft → Tier-2 nudges → memo.
  // Every step's data rides in its input so the plan can resume from the DB.
  const steps: AgentPlanStep[] = [];
  let idx = 0;
  steps.push(step(idx++, "read_queue", { total: input.queue.length, atRisk: atRisk.length }));
  steps.push(step(idx++, "compute_deadline_risk", { risks: atRisk }));
  for (const a of atRisk.slice(0, 5)) {
    steps.push(
      a.band === "overdue"
        ? step(idx++, "create_extension_draft", { publicId: a.publicId })
        : step(idx++, "internal_nudge", { publicId: a.publicId }),
    );
  }
  for (const t of nudgeTargets.slice(0, 5)) {
    steps.push(
      step(idx++, "send_custodian_nudge_email", {
        publicId: t.publicId,
        taskId: t.taskId,
        departmentEmail: t.departmentEmail,
        departmentName: t.departmentName,
      }),
    );
  }
  steps.push(step(idx++, "status_memo", { digest }));

  const run: AgentRunState = {
    id: input.runId ?? "deadline-sweep",
    agencyId,
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
    persist: input.persist,
  });

  return { digest, atRisk, outcome: res.outcome, events, run };
}
