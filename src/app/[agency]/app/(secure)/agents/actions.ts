"use server";

/**
 * Run-steering actions (§16.2): approve a parked step, skip it, or cancel the
 * run. The approval is per-step and attributed to the signed-in staff member —
 * the harness records it on the step's audit event.
 */
import { revalidatePath } from "next/cache";
import {
  AgentSteeringError,
  approveAndResume,
  cancelRun,
  skipStepAndResume,
} from "@/agents/steering";
import { staffAction } from "@/auth/actionWrapper";

export type SteerResult = { ok: true; outcome?: string } | { ok: false; error: string };

export const approveAgentStepAction = staffAction(
  { fallback: "Could not approve the step.", exposes: [AgentSteeringError] },
  async ({ staff, deps, agencySlug }, runId: string, stepIndex: number): Promise<SteerResult> => {
    const res = await approveAndResume(deps, {
      agencyId: staff.agencyId,
      runId,
      stepIndex,
      approver: { userId: staff.userId, label: staff.name ?? staff.email ?? "staff" },
    });
    revalidatePath(`/${agencySlug}/app/agents`);
    return { ok: true, outcome: res.outcome };
  },
);

export const skipAgentStepAction = staffAction(
  { fallback: "Could not skip the step.", exposes: [AgentSteeringError] },
  async ({ staff, deps, agencySlug }, runId: string, stepIndex: number): Promise<SteerResult> => {
    const res = await skipStepAndResume(deps, {
      agencyId: staff.agencyId,
      runId,
      stepIndex,
      actor: { userId: staff.userId, label: staff.name ?? staff.email ?? "staff" },
    });
    revalidatePath(`/${agencySlug}/app/agents`);
    return { ok: true, outcome: res.outcome };
  },
);

export const cancelAgentRunAction = staffAction(
  { fallback: "Could not cancel the run.", exposes: [AgentSteeringError] },
  async ({ staff, deps, agencySlug }, runId: string): Promise<SteerResult> => {
    await cancelRun(deps, {
      agencyId: staff.agencyId,
      runId,
      actor: { userId: staff.userId, label: staff.name ?? staff.email ?? "staff" },
    });
    revalidatePath(`/${agencySlug}/app/agents`);
    return { ok: true };
  },
);
