/**
 * Task workflow (spec §5 Task, §6.3, personas §2) — the connective tissue between
 * the Records Coordinator (portal owner) and the Department Responder (the person
 * who actually holds the records).
 *
 * The loop:
 *   coordinator dispatches a scoped task  →  assigned
 *   responder opens the tokenized page, starts  →  in_progress
 *   responder uploads + submits            →  submitted   (back to coordinator)
 *   responder can't / needs re-scoping     →  pushed_back (back to coordinator)
 *   coordinator accepts                    →  done
 *   coordinator cancels                    →  cancelled
 *
 * Pure and testable; the UI and (later) the DB layer drive it.
 */
export type TaskStatus =
  | "assigned"
  | "in_progress"
  | "submitted"
  | "pushed_back"
  | "done"
  | "cancelled";

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  assigned: ["in_progress", "submitted", "pushed_back", "cancelled"],
  in_progress: ["submitted", "pushed_back", "cancelled"],
  // Coordinator reviews a submission: accept (done) or send back for more.
  submitted: ["done", "in_progress", "pushed_back"],
  // Coordinator re-scopes or reassigns after a pushback.
  pushed_back: ["assigned", "in_progress", "cancelled"],
  done: [],
  cancelled: [],
};

/** Who owns the next move. */
export type Owner = "responder" | "coordinator" | "none";

export function isTaskTerminal(status: TaskStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTaskTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(
      `Illegal task transition: ${from} → ${to}. Allowed: ${
        TRANSITIONS[from].join(", ") || "(none — terminal)"
      }`,
    );
    this.name = "InvalidTaskTransitionError";
  }
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransitionTask(from, to)) throw new InvalidTaskTransitionError(from, to);
  return to;
}

/**
 * Whose court the ball is in. The responder acts while the task is theirs to
 * work; once submitted or pushed back it's the coordinator's move.
 */
export function taskOwner(status: TaskStatus): Owner {
  switch (status) {
    case "assigned":
    case "in_progress":
      return "responder";
    case "submitted":
    case "pushed_back":
      return "coordinator";
    default:
      return "none";
  }
}

export interface TaskLike {
  status: TaskStatus;
  dueAt?: Date | null;
}

export interface TaskRollup {
  total: number;
  byStatus: Record<TaskStatus, number>;
  /** All non-cancelled tasks are done. */
  allComplete: boolean;
  /** Tasks waiting on the coordinator (submitted or pushed back). */
  awaitingCoordinator: number;
  /** Tasks still in a responder's court. */
  awaitingResponders: number;
  /** Pushbacks need attention — a department couldn't fulfill as scoped. */
  needsAttention: number;
  /** Earliest internal task due date among open tasks, if any. */
  nextDueAt: Date | null;
}

/**
 * Roll a request's tasks up into the coordinator's at-a-glance view — the core
 * of "removing the coordinator's role as project manager of twenty parallel
 * timelines" (§16).
 */
export function rollupTasks(tasks: TaskLike[]): TaskRollup {
  const byStatus: Record<TaskStatus, number> = {
    assigned: 0,
    in_progress: 0,
    submitted: 0,
    pushed_back: 0,
    done: 0,
    cancelled: 0,
  };
  let nextDueAt: Date | null = null;

  for (const t of tasks) {
    byStatus[t.status]++;
    if (!isTaskTerminal(t.status) && t.dueAt) {
      if (!nextDueAt || t.dueAt < nextDueAt) nextDueAt = t.dueAt;
    }
  }

  const active = tasks.filter((t) => t.status !== "cancelled");
  const allComplete = active.length > 0 && active.every((t) => t.status === "done");
  const awaitingCoordinator = byStatus.submitted + byStatus.pushed_back;
  const awaitingResponders = byStatus.assigned + byStatus.in_progress;

  return {
    total: tasks.length,
    byStatus,
    allComplete,
    awaitingCoordinator,
    awaitingResponders,
    needsAttention: byStatus.pushed_back,
    nextDueAt,
  };
}

/** Human-readable label for a task status. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  submitted: "Submitted for review",
  pushed_back: "Pushed back",
  done: "Done",
  cancelled: "Cancelled",
};
