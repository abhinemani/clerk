/**
 * Task use cases (spec §5, §6.3) — the coordinator ↔ department-responder loop.
 *
 * Dispatch a scoped task to a department (assigned) → the responder works it from
 * a tokenized page → submits records or pushes back → the coordinator accepts or
 * reopens. Every hand-off goes through the task state machine and appends an
 * audit event.
 */
import { assertTaskTransition } from "@/domain/taskWorkflow";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type TaskEntity } from "./repository";

export interface DispatchTaskInput {
  agencyId: string;
  requestId: string;
  departmentId?: string;
  departmentName?: string;
  scopeText: string;
  dueAt?: Date;
  actorUserId?: string;
}

export async function dispatchTask(deps: ServiceDeps, input: DispatchTaskInput): Promise<TaskEntity> {
  const { repo } = deps;
  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);

  const task = await repo.createTask({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    departmentId: input.departmentId ?? null,
    scopeText: input.scopeText,
    status: "assigned",
    token: deps.genToken(),
    dueAt: input.dueAt ?? null,
    uploads: [],
    pushbackNotes: null,
  });

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: request.id,
    kind: "assignment",
    actorUserId: input.actorUserId ?? null,
    summary: `Task dispatched to ${input.departmentName ?? "department"}`,
    payload: { taskId: task.id, departmentId: input.departmentId ?? null, token: task.token },
    createdAt: deps.now(),
  });

  return task;
}

async function loadTask(deps: ServiceDeps, agencyId: string, taskId: string): Promise<TaskEntity> {
  const t = await deps.repo.getTask(agencyId, taskId);
  if (!t) throw new NotFoundError("Task", taskId);
  return t;
}

/** Responder marks the task started (assigned → in_progress). */
export async function startTask(deps: ServiceDeps, agencyId: string, taskId: string): Promise<TaskEntity> {
  const task = await loadTask(deps, agencyId, taskId);
  assertTaskTransition(task.status, "in_progress");
  return deps.repo.updateTask(agencyId, taskId, { status: "in_progress" });
}

/** Responder submits records back to the coordinator. */
export async function submitTaskRecords(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; uploads: { name: string; pages?: number }[] },
): Promise<TaskEntity> {
  const task = await loadTask(deps, input.agencyId, input.taskId);
  assertTaskTransition(task.status, "submitted");
  const updated = await deps.repo.updateTask(input.agencyId, input.taskId, {
    status: "submitted",
    uploads: [...task.uploads, ...input.uploads],
  });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: task.requestId,
    kind: "note",
    actorUserId: null,
    summary: `Department submitted ${input.uploads.length} record(s)`,
    payload: { taskId: task.id, uploadCount: updated.uploads.length },
    createdAt: deps.now(),
  });
  return updated;
}

/** Responder can't fulfill as scoped — pushes back with a reason. */
export async function pushBackTask(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; note: string },
): Promise<TaskEntity> {
  const task = await loadTask(deps, input.agencyId, input.taskId);
  assertTaskTransition(task.status, "pushed_back");
  const updated = await deps.repo.updateTask(input.agencyId, input.taskId, {
    status: "pushed_back",
    pushbackNotes: input.note,
  });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: task.requestId,
    kind: "note",
    actorUserId: null,
    summary: "Department pushed the task back",
    payload: { taskId: task.id, note: input.note },
    createdAt: deps.now(),
  });
  return updated;
}

/** Coordinator accepts the submitted records (submitted → done). */
export async function acceptTaskRecords(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; actorUserId: string },
): Promise<TaskEntity> {
  const task = await loadTask(deps, input.agencyId, input.taskId);
  assertTaskTransition(task.status, "done");
  const updated = await deps.repo.updateTask(input.agencyId, input.taskId, { status: "done" });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: task.requestId,
    kind: "approval",
    actorUserId: input.actorUserId,
    summary: "Coordinator accepted the department's records",
    payload: { taskId: task.id },
    createdAt: deps.now(),
  });
  return updated;
}
