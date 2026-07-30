/**
 * Workflow automation policy + pure assignment logic (§6.3 adjacent).
 *
 * Two opt-in, per-agency behaviors that turn the coordinator from router into
 * supervisor:
 *  - auto-assign: new requests are load-balanced across coordinators;
 *  - auto-dispatch: routing suggestions above a confidence threshold create
 *    and deliver department tasks unattended.
 *
 * Both default OFF — an agency opts into autonomy, it is never imposed. And
 * neither touches invariant 4 territory: who works a request and which
 * department is asked are internal workflow moves; everything a requester
 * sees still requires a named human. Every automated move writes the same
 * audit events a human's would, attributed to the system actor (null user).
 */

export interface WorkflowSettings {
  /** Load-balance new requests across coordinators at intake. */
  autoAssign?: boolean;
  /** Dispatch high-confidence routing suggestions without a coordinator click. */
  autoDispatch?: boolean;
  /** Minimum routing-suggestion confidence (0–1) to dispatch unattended. */
  autoDispatchConfidence?: number;
}

export const DEFAULT_AUTO_DISPATCH_CONFIDENCE = 0.8;

/** Normalized view with defaults applied — the shape services consume. */
export interface EffectiveWorkflowSettings {
  autoAssign: boolean;
  autoDispatch: boolean;
  autoDispatchConfidence: number;
}

export function effectiveWorkflowSettings(
  raw: WorkflowSettings | null | undefined,
): EffectiveWorkflowSettings {
  const threshold = raw?.autoDispatchConfidence;
  return {
    autoAssign: raw?.autoAssign === true,
    autoDispatch: raw?.autoDispatch === true,
    autoDispatchConfidence:
      typeof threshold === "number" && threshold >= 0 && threshold <= 1
        ? threshold
        : DEFAULT_AUTO_DISPATCH_CONFIDENCE,
  };
}

export interface AssignableCoordinator {
  userId: string;
  /** Open (unclosed) requests currently assigned to this user. */
  openAssigned: number;
}

/**
 * Pick the coordinator for a new request: least-loaded wins; ties break on
 * userId so the choice is deterministic (same inputs, same answer — the
 * event log must be replayable). Returns null when nobody is assignable.
 */
export function pickCoordinator(candidates: AssignableCoordinator[]): string | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const c of candidates.slice(1)) {
    if (c.openAssigned < best.openAssigned || (c.openAssigned === best.openAssigned && c.userId < best.userId)) {
      best = c;
    }
  }
  return best.userId;
}

/** Roles that can own a request end-to-end (queue triage + release authority). */
export const ASSIGNABLE_ROLES = ["admin", "coordinator"] as const;

export function isAssignableRole(role: string): boolean {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}
