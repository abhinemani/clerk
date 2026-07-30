/**
 * Task use cases (spec §5, §6.3) — the coordinator ↔ department-responder loop.
 *
 * Dispatch a scoped task to a department (assigned) → the responder works it from
 * a tokenized page → submits records or pushes back → the coordinator accepts or
 * reopens. Every hand-off goes through the task state machine and appends an
 * audit event.
 */
import { assertTaskTransition } from "@/domain/taskWorkflow";
import { effectiveWorkflowSettings } from "@/domain/workflow";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type TaskEntity } from "./repository";
import { defaultDispatchBody, inboundAddress, taskUrl } from "./notifications";
import { transitionRequest } from "./requestService";

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
      // A responder can just reply with attachments — email-in (§6.5).
      replyTo: inboundAddress("task", task.token),
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

export interface AutoDispatchSuggestion {
  departmentId: string;
  department: string;
  scope: string;
  confidence: number;
}

export interface AutoDispatchResult {
  dispatched: number;
  heldForReview: number;
  reason?: string;
}

/** Internal SLA for department tasks — ahead of the statutory clock. */
const AUTO_DISPATCH_TASK_SLA_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Confidence-gated auto-dispatch (opt-in via agency workflowSettings): routing
 * suggestions at or above the agency's threshold become dispatched tasks with
 * no coordinator click. Everything below the threshold stays a proposal card.
 *
 * Guard rails: fires only on a fresh request (submitted/in_review) with no
 * existing tasks — a queue a human has already started working is never
 * second-guessed. Dispatch itself goes through dispatchTask, so the audit
 * events, no-login token, and delivery are identical to the manual path; the
 * coordinator can recall any auto-dispatched task the same way they cancel a
 * manual one. Department notice is internal workflow, not a requester-facing
 * action, so invariant 4 is not in play — but every move is evented.
 */
export async function autoDispatchSuggestions(
  deps: ServiceDeps,
  input: { agencyId: string; requestId: string; suggestions: AutoDispatchSuggestion[] },
): Promise<AutoDispatchResult> {
  const { repo } = deps;
  const agency = await repo.getAgency(input.agencyId);
  if (!agency) throw new NotFoundError("Agency", input.agencyId);
  const workflow = effectiveWorkflowSettings(agency.workflowSettings);
  if (!workflow.autoDispatch) return { dispatched: 0, heldForReview: 0, reason: "disabled" };

  const request = await repo.getRequest(input.agencyId, input.requestId);
  if (!request) throw new NotFoundError("Request", input.requestId);
  if (request.status !== "submitted" && request.status !== "in_review") {
    return { dispatched: 0, heldForReview: 0, reason: `request is ${request.status}` };
  }
  const existing = await repo.listTasks(input.agencyId, input.requestId);
  if (existing.length > 0) {
    return { dispatched: 0, heldForReview: 0, reason: "tasks already exist" };
  }

  const eligible = input.suggestions.filter((s) => s.confidence >= workflow.autoDispatchConfidence);
  const held = input.suggestions.length - eligible.length;
  if (eligible.length === 0) return { dispatched: 0, heldForReview: held, reason: "below threshold" };

  const departments = await repo.listDepartments(input.agencyId);
  const deptById = new Map(departments.map((d) => [d.id, d]));

  // Same forward motion the manual dispatch action applies, system-attributed.
  if (request.status === "submitted") {
    await transitionRequest(deps, {
      agencyId: input.agencyId,
      requestId: input.requestId,
      to: "in_review",
      note: "First dispatch (auto)",
    });
  }
  await transitionRequest(deps, {
    agencyId: input.agencyId,
    requestId: input.requestId,
    to: "in_progress",
    note: "Departments working (auto-dispatch)",
  });

  const dispatchedTo: string[] = [];
  for (const s of eligible) {
    const dept = deptById.get(s.departmentId);
    if (!dept) continue;
    await dispatchTask({ ...deps, agencyName: deps.agencyName ?? agency.name }, {
      agencyId: input.agencyId,
      requestId: input.requestId,
      departmentId: dept.id,
      departmentName: dept.name,
      departmentEmail: dept.defaultResponderEmails[0],
      departmentLead: dept.name,
      scopeText: s.scope,
      dueAt: new Date(deps.now().getTime() + AUTO_DISPATCH_TASK_SLA_MS),
    });
    dispatchedTo.push(dept.name);
  }

  await repo.appendEvent({
    id: deps.genId(),
    agencyId: input.agencyId,
    requestId: input.requestId,
    kind: "ai_action",
    actorUserId: null,
    summary: `Auto-dispatched ${dispatchedTo.length} task(s) to ${dispatchedTo.join(", ")} (confidence ≥ ${workflow.autoDispatchConfidence})${held > 0 ? `; ${held} suggestion(s) held for review` : ""}`,
    payload: {
      pipeline: "auto_dispatch",
      dispatched: dispatchedTo,
      heldForReview: held,
      threshold: workflow.autoDispatchConfidence,
    },
    createdAt: deps.now(),
  });

  return { dispatched: dispatchedTo.length, heldForReview: held };
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
    replyTo: inboundAddress("task", task.token),
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
export interface TaskUploadInput {
  name: string;
  pages?: number;
  /** Real bytes were stored: object key + integrity metadata. */
  blobRef?: string;
  byteSize?: number;
  mimeType?: string;
  checksum?: string;
  /** Text rendition extracted at upload (§6.5) — enables the redaction studio. */
  extractedText?: string;
  pageCount?: number;
}

export async function submitTaskRecords(
  deps: ServiceDeps,
  input: { agencyId: string; taskId: string; uploads: TaskUploadInput[] },
): Promise<TaskEntity> {
  const task = await loadTask(deps, input.agencyId, input.taskId);
  assertTaskTransition(task.status, "submitted");
  const updated = await deps.repo.updateTask(input.agencyId, input.taskId, {
    status: "submitted",
    uploads: [...task.uploads, ...input.uploads.map((u) => ({ name: u.name, pages: u.pages }))],
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
      processingStatus: upload.blobRef ? "ready" : "received",
      metadata: { pages: upload.pages ?? null, taskId: task.id },
      blobRef: upload.blobRef ?? null,
      byteSize: upload.byteSize ?? null,
      mimeType: upload.mimeType ?? null,
      checksum: upload.checksum ?? null,
      extractedText: upload.extractedText ?? null,
      pageCount: upload.pageCount ?? null,
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
