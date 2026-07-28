/**
 * Request activity — the overall-management / source-of-truth view (spec §5, §8).
 *
 * A request's canonical state is the **append-only event log** (who did what,
 * when) plus the **live task rollup** (which departments owe what). This service
 * assembles both into one view the coordinator manages the request from — the
 * answer to "where does this stand across the clerk and every department?"
 */
import { rollupTasks, type TaskRollup } from "@/domain/taskWorkflow";
import type { ServiceDeps } from "./deps";
import { NotFoundError, type EventEntity, type RequestEntity, type TaskEntity } from "./repository";

export interface RequestActivity {
  request: RequestEntity;
  /** The append-only audit log, chronological — the litigation defense (§10). */
  events: EventEntity[];
  tasks: TaskEntity[];
  taskRollup: TaskRollup;
  /** What the coordinator should look at next. */
  attention: {
    /** Tasks a department pushed back — need a coordinator decision. */
    pushedBack: number;
    /** Records submitted and awaiting the coordinator's review. */
    awaitingReview: number;
    /** Departments still working. */
    awaitingDepartments: number;
    /** All dispatched tasks are complete. */
    readyToRelease: boolean;
  };
}

export async function getRequestActivity(
  deps: ServiceDeps,
  agencyId: string,
  requestId: string,
): Promise<RequestActivity> {
  const request = await deps.repo.getRequest(agencyId, requestId);
  if (!request) throw new NotFoundError("Request", requestId);

  const [events, tasks] = await Promise.all([
    deps.repo.listEvents(agencyId, requestId),
    deps.repo.listTasks(agencyId, requestId),
  ]);

  const taskRollup = rollupTasks(tasks.map((t) => ({ status: t.status, dueAt: t.dueAt })));

  return {
    request,
    events,
    tasks,
    taskRollup,
    attention: {
      pushedBack: taskRollup.needsAttention,
      awaitingReview: taskRollup.byStatus.submitted,
      awaitingDepartments: taskRollup.awaitingResponders,
      readyToRelease: taskRollup.allComplete,
    },
  };
}
