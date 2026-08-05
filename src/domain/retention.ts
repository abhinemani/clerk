/**
 * Retention awareness + legal holds — the guard against the catastrophic
 * failure mode: destroying a record that is responsive to an open public
 * records request. That is spoliation, and no amount of good workflow
 * elsewhere survives it.
 *
 * Two independent facts about a document:
 *   - retentionUntil: the agency's own schedule ("destroy after this date").
 *   - legalHoldReason: a human-readable "do not destroy", which OVERRIDES the
 *     schedule for as long as it is set.
 *
 * Pure: takes the document's fields and the clock as arguments, touches no
 * globals — same discipline as the statute engine.
 */

export type RetentionState =
  /** On hold — must not be destroyed, whatever the schedule says. */
  | "held"
  /** Past its retention date and NOT held — eligible for destruction. */
  | "eligible_for_destruction"
  /** Retention date is near (within the warning window). */
  | "expiring_soon"
  /** Retained, nothing to flag. */
  | "retained"
  /** No schedule recorded — we cannot say anything honest about it. */
  | "unscheduled";

export interface RetentionInput {
  retentionUntil?: Date | null;
  legalHoldReason?: string | null;
  /** Does at least one OPEN request currently include this document? */
  inOpenRequest?: boolean;
}

/** Days before the retention date that we start warning. */
export const RETENTION_WARNING_DAYS = 30;

export interface RetentionStatus {
  state: RetentionState;
  /** Days until the retention date (negative = past it); null when unscheduled. */
  daysRemaining: number | null;
  /** One-line, staff-facing explanation — the honest version, never a guess. */
  label: string;
  /** True when destroying this document now would be a defensible mistake. */
  blocksDestruction: boolean;
}

const MS_DAY = 86_400_000;

export function retentionStatus(
  doc: RetentionInput,
  now: Date,
  warningDays = RETENTION_WARNING_DAYS,
): RetentionStatus {
  // A hold wins over everything, including an expired schedule — that is the
  // entire point of a hold.
  if (doc.legalHoldReason) {
    return {
      state: "held",
      daysRemaining: doc.retentionUntil
        ? Math.ceil((doc.retentionUntil.getTime() - now.getTime()) / MS_DAY)
        : null,
      label: `Legal hold — ${doc.legalHoldReason}`,
      blocksDestruction: true,
    };
  }

  if (!doc.retentionUntil) {
    return {
      state: "unscheduled",
      daysRemaining: null,
      // An open request still protects the record even with no schedule on file.
      label: doc.inOpenRequest
        ? "No retention schedule on file — but it is part of an open request"
        : "No retention schedule on file",
      blocksDestruction: doc.inOpenRequest === true,
    };
  }

  const daysRemaining = Math.ceil((doc.retentionUntil.getTime() - now.getTime()) / MS_DAY);

  if (daysRemaining <= 0) {
    return {
      state: "eligible_for_destruction",
      daysRemaining,
      label:
        daysRemaining === 0
          ? "Retention period ends today"
          : `Retention period ended ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`,
      blocksDestruction: false,
    };
  }

  if (daysRemaining <= warningDays) {
    return {
      state: "expiring_soon",
      daysRemaining,
      label: `Scheduled for destruction in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`,
      blocksDestruction: false,
    };
  }

  return {
    state: "retained",
    daysRemaining,
    label: `Retained for ${daysRemaining} more days`,
    blocksDestruction: false,
  };
}

/**
 * The one question the request page asks: which documents in this review set
 * are at risk of destruction while the request is still open? Anything held is
 * already safe; anything expiring or expired without a hold is the problem.
 */
export function documentsAtRetentionRisk<T extends RetentionInput & { id: string }>(
  docs: readonly T[],
  now: Date,
  warningDays = RETENTION_WARNING_DAYS,
): { doc: T; status: RetentionStatus }[] {
  return docs
    .map((doc) => ({ doc, status: retentionStatus(doc, now, warningDays) }))
    .filter(
      ({ status }) =>
        status.state === "eligible_for_destruction" || status.state === "expiring_soon",
    );
}

/** The hold reason auto-applied when a document joins an open request. */
export function autoHoldReason(publicId: string): string {
  return `Responsive to open request ${publicId}`;
}

/** Is this hold one the system placed automatically (vs. a human's own note)? */
export function isAutoHold(reason: string | null | undefined): boolean {
  return typeof reason === "string" && reason.startsWith("Responsive to open request ");
}
