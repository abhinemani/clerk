/**
 * Request lifecycle state machine (spec §5 status enum).
 *
 * The request status drives the queue, SLAs, and what actions are available.
 * Transitions are constrained here so an illegal status jump is impossible, and
 * every change is auditable (callers log a status_change RequestEvent, §5/§10).
 *
 * Pure, exhaustively testable — no I/O.
 */
export type RequestStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "clarification_needed"
  | "in_progress"
  | "records_review"
  | "partially_fulfilled"
  | "fulfilled"
  | "denied"
  | "referred"
  | "withdrawn"
  | "closed";

/**
 * Allowed forward transitions. Withdrawal and denial are reachable from most
 * active states; `closed` is the single terminal sink.
 */
// "fulfilled" is reachable from every open working state, not only
// records_review: answering with a link to ALREADY-PUBLIC records (the
// fulfill-by-reference path) legitimately closes a request that never needed
// document production. The act is still a named human's explicit decision —
// the service layer enforces that; this map only says the move is legal.
const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["in_review", "fulfilled", "referred", "withdrawn"],
  in_review: ["clarification_needed", "in_progress", "fulfilled", "denied", "referred", "withdrawn"],
  clarification_needed: ["in_review", "in_progress", "fulfilled", "denied", "referred", "withdrawn"],
  in_progress: ["records_review", "clarification_needed", "fulfilled", "denied", "referred", "withdrawn"],
  records_review: ["partially_fulfilled", "fulfilled", "in_progress", "denied"],
  partially_fulfilled: ["records_review", "fulfilled", "denied", "closed"],
  fulfilled: ["closed"],
  denied: ["closed"],
  referred: ["closed"],
  withdrawn: ["closed"],
  closed: [],
};

/** States from which no further transition is possible. */
export function isTerminal(status: RequestStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** The statuses reachable in one step from `status`. */
export function nextStates(status: RequestStatus): readonly RequestStatus[] {
  return TRANSITIONS[status];
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RequestStatus,
    readonly to: RequestStatus,
  ) {
    super(
      `Illegal request status transition: ${from} → ${to}. Allowed: ${
        TRANSITIONS[from].join(", ") || "(none — terminal)"
      }`,
    );
    this.name = "InvalidTransitionError";
  }
}

/** Assert a transition is legal, throwing otherwise. Returns the target status. */
export function assertTransition(from: RequestStatus, to: RequestStatus): RequestStatus {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
  return to;
}

/** Statuses that count as "open" for queue/SLA purposes (not terminal, not draft). */
export function isOpen(status: RequestStatus): boolean {
  return status !== "draft" && !isTerminal(status);
}

/** All statuses — handy for exhaustive iteration in tests/UI. */
export const ALL_STATUSES = Object.keys(TRANSITIONS) as RequestStatus[];
