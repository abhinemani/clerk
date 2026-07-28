"use server";

/**
 * Coordinator workspace actions — the moves that used to be client-side
 * theater are now real: every one goes through the service layer, appends to
 * the append-only audit log, and revalidates the page. The staff session is
 * re-derived server-side on each call.
 */
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/auth/guards";
import { getRepository } from "@/db/createRepository";
import { defaultDeps } from "@/services/deps";
import { approveTriage, transitionRequest } from "@/services/requestService";
import {
  acceptTaskRecords,
  dispatchTask,
  reassignTask,
  returnTaskToResponder,
} from "@/services/taskService";

export type WorkspaceResult = { ok: true } | { ok: false; error: string };

const MS_DAY = 86_400_000;

async function ctx(agencySlug: string) {
  const staff = await requireStaff(agencySlug);
  const repo = await getRepository();
  const deps = { ...defaultDeps(repo), agencyName: undefined as string | undefined };
  const agency = await repo.getAgency(staff.agencyId);
  deps.agencyName = agency?.name;
  return { staff, repo, deps };
}

function fail(op: string, e: unknown): WorkspaceResult {
  console.error(`${op} failed`, e);
  const message = e instanceof Error ? e.message : "Something went wrong.";
  return { ok: false, error: message };
}

export async function acceptTriageAction(input: {
  agencySlug: string;
  requestId: string;
  interpretedScope: string;
  recordTypes: string[];
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await approveTriage(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      actorUserId: staff.userId,
      interpretedScope: input.interpretedScope,
      recordTypes: input.recordTypes,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("acceptTriage", e);
  }
}

export async function dismissTriageAction(input: {
  agencySlug: string;
  requestId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await deps.repo.appendEvent({
      id: deps.genId(),
      agencyId: staff.agencyId,
      requestId: input.requestId,
      kind: "note",
      actorUserId: staff.userId,
      summary: "Coordinator dismissed the triage draft",
      createdAt: deps.now(),
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("dismissTriage", e);
  }
}

export async function dispatchTaskAction(input: {
  agencySlug: string;
  requestId: string;
  departmentId: string;
  scopeText: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, repo, deps } = await ctx(input.agencySlug);
    const departments = await repo.listDepartments(staff.agencyId);
    const dept = departments.find((d) => d.id === input.departmentId);
    if (!dept) return { ok: false, error: "Unknown department." };

    // Move a fresh request forward when its first task goes out.
    const request = await repo.getRequest(staff.agencyId, input.requestId);
    if (request?.status === "submitted") {
      await transitionRequest(deps, {
        agencyId: staff.agencyId,
        requestId: input.requestId,
        to: "in_review",
        actorUserId: staff.userId,
        note: "First dispatch",
      });
    }
    if (request?.status === "submitted" || request?.status === "in_review") {
      await transitionRequest(deps, {
        agencyId: staff.agencyId,
        requestId: input.requestId,
        to: "in_progress",
        actorUserId: staff.userId,
        note: "Departments working",
      });
    }

    await dispatchTask(deps, {
      agencyId: staff.agencyId,
      requestId: input.requestId,
      departmentId: dept.id,
      departmentName: dept.name,
      departmentEmail: dept.defaultResponderEmails[0],
      departmentLead: dept.name,
      scopeText: input.scopeText,
      dueAt: new Date(Date.now() + 3 * MS_DAY), // internal SLA, ahead of statute
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("dispatchTask", e);
  }
}

export async function acceptRecordsAction(input: {
  agencySlug: string;
  requestId: string;
  taskId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await acceptTaskRecords(deps, {
      agencyId: staff.agencyId,
      taskId: input.taskId,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("acceptRecords", e);
  }
}

export async function sendBackAction(input: {
  agencySlug: string;
  requestId: string;
  taskId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await returnTaskToResponder(deps, {
      agencyId: staff.agencyId,
      taskId: input.taskId,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("sendBack", e);
  }
}

export async function reassignTaskAction(input: {
  agencySlug: string;
  requestId: string;
  taskId: string;
}): Promise<WorkspaceResult> {
  try {
    const { staff, deps } = await ctx(input.agencySlug);
    await reassignTask(deps, {
      agencyId: staff.agencyId,
      taskId: input.taskId,
      actorUserId: staff.userId,
    });
    revalidatePath(`/${input.agencySlug}/app/requests/${input.requestId}`);
    return { ok: true };
  } catch (e) {
    return fail("reassignTask", e);
  }
}
