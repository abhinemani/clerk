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
import { defaultDispatchBody, taskUrl } from "./notifications";

export interface DispatchTaskInput {
  agencyId: string;
  requestId: string;
  departmentId?: string;
  departmentName?: string;
  /** Department head to notify — the person who actually holds the records. */
  departmentEmail?: string;
  departmentLead?: string;
  scopeText: string;
  dueAt?: Date;
  actorUserId?: string;
  /** Optional AI-drafted notice body (§6.6); falls back to the default template. */
  draftedBody?: { subject: string; body: string };
}

/**
 * The clerk shares a scoped request with a department head: create the task,
 * log the assignment, and — if a notifier and recipient are configured — deliver
 * the no-login link and record the delivery. The audit log is the source of truth.
 */
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

  // Actually deliver the task to the department head (§4 email interface).
  if (deps.notifier && input.departmentEmail) {
    const link = taskUrl(task.token, deps.baseUrl);
    const drafted =
      input.draftedBody ??
      defaultDispatchBody({
        departmentLead: input.departmentLead,
        agencyName: deps.agencyName ?? "Records office",
        publicId: request.publicId,
        scope: input.scopeText,
        link,
      });
    const receipt = await deps.notifier.send({
      agencyId: input.agencyId,
      to: input.departmentEmail,
      subject: drafted.subject,
      body: drafted.body,
      kind: "task_dispatch",
      requestId: request.id,
      taskId: task.id,
    });
    await repo.appendEvent({
      id: deps.genId(),
      agencyId: input.agencyId,
      requestId: request.id,
      kind: "delivery",
      actorUserId: input.actorUserId ?? null,
      summary: `Task link delivered to ${input.departmentName ?? "department"} (${input.departmentEmail})`,
      payload: { taskId: task.id, to: input.departmentEmail, channel: receipt.channel, deliveryId: receipt.id },
      createdAt: deps.now(),
    });
  }

  return task;
}

/**
 * Send a reminder nudge to the department head for an outstanding task
 * (§16.1 deadline agent; Tier-2 `staff_reminder_email`). Recorded as a delivery.
 */
export async function remindResponder(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; departmentEmail: string; departmentName?: string },
): Promise<void> {
  if (!deps.notifier) return;
  const task = await deps.repo.getTask(input.agencyId, input.taskId);
  if (!task) throw new NotFoundError("Task", input.taskId);

  const link = taskUrl(task.token, deps.baseUrl);
  const receipt = await deps.notifier.send({
    agencyId: input.agencyId,
    to: input.departmentEmail,
    subject: `Reminder: records still needed`,
    body: `This task is still open. Please attach records or push back:\n${link}\n\nWhat we need: ${task.scopeText}`,
    kind: "task_reminder",
    requestId: task.requestId,
    taskId: task.id,
  });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: task.requestId,
    kind: "delivery",
    actorUserId: null,
    summary: `Reminder sent to ${input.departmentName ?? "department"} (${input.departmentEmail})`,
    payload: { taskId: task.id, to: input.departmentEmail, channel: receipt.channel, kind: "task_reminder" },
    createdAt: deps.now(),
  });
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

/**
 * Responder submits records back to the coordinator. Each upload becomes a
 * corpus document (provenance: responder_upload, internal until reviewed)
 * attached to the request — the review set the release flow decides over.
 */
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

  for (const upload of input.uploads) {
    const doc = await deps.repo.createDocument({
      id: deps.genId(),
      agencyId: input.agencyId,
      sourceId: null,
      externalSystemId: null,
      filename: upload.name,
      classification: "internal", // never public before a human decides
      recordType: null,
      processingStatus: "received",
      metadata: { pages: upload.pages ?? null, taskId: task.id },
      createdAt: deps.now(),
    });
    await deps.repo.linkRequestDocument(input.agencyId, task.requestId, doc.id);
  }
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

/** Coordinator sends submitted records back for more work (submitted → in_progress). */
export async function returnTaskToResponder(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; actorUserId: string; note?: string },
): Promise<TaskEntity> {
  const task = await loadTask(deps, input.agencyId, input.taskId);
  assertTaskTransition(task.status, "in_progress");
  const updated = await deps.repo.updateTask(input.agencyId, input.taskId, { status: "in_progress" });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: task.requestId,
    kind: "note",
    actorUserId: input.actorUserId,
    summary: "Coordinator sent the records back for more work",
    payload: { taskId: task.id, note: input.note },
    createdAt: deps.now(),
  });
  return updated;
}

/** Coordinator re-scopes/reassigns after a pushback (pushed_back → assigned). */
export async function reassignTask(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; actorUserId: string; scopeText?: string },
): Promise<TaskEntity> {
  const task = await loadTask(deps, input.agencyId, input.taskId);
  assertTaskTransition(task.status, "assigned");
  const updated = await deps.repo.updateTask(input.agencyId, input.taskId, {
    status: "assigned",
    ...(input.scopeText ? { scopeText: input.scopeText } : {}),
  });
  await deps.repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: task.requestId,
    kind: "assignment",
    actorUserId: input.actorUserId,
    summary: "Coordinator re-scoped and reassigned the task after pushback",
    payload: { taskId: task.id, scopeText: input.scopeText ?? task.scopeText },
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
