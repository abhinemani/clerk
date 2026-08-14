import Link from "next/link";
import { AGENT_DEFINITIONS } from "@/agents/definitions";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { dateShort } from "@/lib/format";
import type { AgentRunEntity } from "@/services/repository";
import { approveAgentStepAction, cancelAgentRunAction, skipAgentStepAction } from "./actions";

export const dynamic = "force-dynamic";

// Form-action wrappers (forms need void returns; errors surface as no-ops and
// the refreshed page still shows the parked run).
async function approveForm(slug: string, runId: string, stepIndex: number): Promise<void> {
  "use server";
  await approveAgentStepAction(slug, runId, stepIndex);
}
async function skipForm(slug: string, runId: string, stepIndex: number): Promise<void> {
  "use server";
  await skipAgentStepAction(slug, runId, stepIndex);
}
async function cancelForm(slug: string, runId: string): Promise<void> {
  "use server";
  await cancelAgentRunAction(slug, runId);
}

/**
 * Agent runs — the steering surface (§16.2): every persisted run, with parked
 * runs (awaiting a human checkpoint) up top. Approval is per-step and named;
 * the resumed run executes through the same guardrailed harness.
 */

const STATUS_LABEL: Record<AgentRunEntity["status"], string> = {
  planning: "Planning",
  running: "Running",
  paused: "Paused",
  awaiting_checkpoint: "Needs your approval",
  completed: "Completed",
  exhausted: "Budget exhausted",
  failed: "Failed",
  cancelled: "Cancelled",
};

const STEP_GLYPH: Record<string, string> = {
  done: "✓",
  skipped: "⏭",
  blocked: "✕",
  awaiting_human: "⏸",
  pending: "·",
};

function agentTitle(type: AgentRunEntity["agentType"]): string {
  return AGENT_DEFINITIONS[type]?.title ?? type;
}

export default async function AgentRunsPage({ params }: { params: Promise<{ agency: string }> }) {
  const { agency: slug } = await params;
  const staff = await requireStaff(slug);
  const repo = await getRepository();
  const runs = (await repo.listAgentRuns(staff.agencyId)).slice(0, 20);
  const parked = runs.filter((r) => r.status === "awaiting_checkpoint");
  const rest = runs.filter((r) => r.status !== "awaiting_checkpoint");

  return (
    <div className="wrap" style={{ maxWidth: 860, paddingBlock: "36px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="eyebrow">Records oversight · Agents</span>
          <h1 style={{ fontSize: "1.7rem", marginTop: 6 }}>Agent runs</h1>
        </div>
        <Link href={`/${slug}/app`} className="btn btn-sm">
          ← Command center
        </Link>
      </div>
      <p className="muted" style={{ marginTop: 8, fontSize: "0.92rem", maxWidth: 640 }}>
        Agents work through guardrailed plans and PARK whenever a step needs a human — approving
        executes exactly that step, under your name, in the audit log. Nothing external is sent
        without an approval here (or an explicit agency opt-in).
      </p>

      {runs.length === 0 && (
        <div className="card card-pad" style={{ marginTop: 20 }}>
          <p className="muted" style={{ margin: 0 }}>
            No agent runs yet. The nightly deadline sweep records its runs here; runs that need an
            approval will wait for you at the top of this page.
          </p>
        </div>
      )}

      {parked.map((run) => {
        const step = run.plan?.steps[run.plan.cursor];
        return (
          <div key={run.id} className="card card-pad" style={{ marginTop: 20, borderColor: "var(--due-border, var(--due))" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="panel-title">⏸ {agentTitle(run.agentType)} — {STATUS_LABEL[run.status]}</div>
              <span className="muted" style={{ fontSize: "0.8rem" }}>{dateShort(run.createdAt)}</span>
            </div>
            <div style={{ marginTop: 6, fontWeight: 600 }}>{run.goal}</div>
            {step ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: "0.92rem" }}>
                  Wants to run <span className="mono">{step.action ?? step.tool}</span>
                  {typeof step.input?.publicId === "string" ? <> for <span className="mono">{step.input.publicId}</span></> : null}
                  {typeof step.input?.departmentEmail === "string" ? <> → email to <span className="mono">{step.input.departmentEmail}</span></> : null}
                </div>
                <p className="muted" style={{ fontSize: "0.82rem", margin: "6px 0 0" }}>
                  This is a Tier-2 external action — it needs a named approval (or a standing agency
                  opt-in) before it executes. Approving sends it under your name.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <form action={approveForm.bind(null, slug, run.id, step.index)}>
                    <button className="btn btn-sm btn-primary" type="submit">Approve &amp; resume</button>
                  </form>
                  <form action={skipForm.bind(null, slug, run.id, step.index)}>
                    <button className="btn btn-sm" type="submit">Skip this step</button>
                  </form>
                  <form action={cancelForm.bind(null, slug, run.id)}>
                    <button className="btn btn-sm btn-ghost" type="submit">Cancel run</button>
                  </form>
                </div>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: "0.85rem", marginTop: 8 }}>Parked without a pending step — cancel the run.</p>
            )}
          </div>
        );
      })}

      {rest.length > 0 && (
        <div className="card" style={{ marginTop: 20, overflow: "hidden" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rest.map((run) => {
              const steps = run.plan?.steps ?? [];
              const done = steps.filter((s) => s.status === "done").length;
              return (
                <li key={run.id} style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{agentTitle(run.agentType)}</span>
                    <span className="pill">{STATUS_LABEL[run.status]}</span>
                    <span className="muted" style={{ fontSize: "0.82rem" }}>
                      {done}/{steps.length} steps · {run.budgetSpend?.toolCalls ?? 0} tool call(s) · {dateShort(run.createdAt)}
                    </span>
                  </div>
                  <div className="muted" style={{ fontSize: "0.85rem", marginTop: 4 }}>{run.goal}</div>
                  {steps.length > 0 && (
                    <div className="mono muted" style={{ fontSize: "0.78rem", marginTop: 6, letterSpacing: "0.12em" }}>
                      {steps.map((s) => STEP_GLYPH[s.status] ?? "·").join(" ")}
                    </div>
                  )}
                  {run.handoffNote && (
                    <div className="muted" style={{ fontSize: "0.82rem", marginTop: 6 }}>{run.handoffNote}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
