/**
 * computeDueDate() — statutory deadline computation (spec §7).
 *
 * "Build computeDueDate() as a pure, heavily unit-tested function — this is the
 *  single most testable piece of compliance logic in the product." (§7)
 *
 * The function is pure: same inputs → same output, no clock reads, no I/O. It
 * respects the agency's business-day calendar and observed holidays, and returns
 * not just a date but the *basis* for that date, so callers can log every
 * computed/extended deadline with its reasoning (§7, §5 RequestEvent).
 */
import type { StatuteConfig } from "@/db/schema";
import {
  addBusinessDays,
  addUtcDays,
  holidaySet,
  isBusinessDay,
  isoDate,
  nextBusinessDay,
  rollForwardToBusinessDay,
  utcDateFloor,
} from "./businessDays";

export type ResponseClock = StatuteConfig["responseClock"];

export interface ComputeDueDateArgs {
  /** When the request was received (the event that starts the clock). */
  receivedAt: Date;
  /** The agency's statutory response-clock config (§7). */
  clock: ResponseClock;
  /** Agency observed holidays as ISO date strings ("2026-07-03"). */
  holidays?: readonly string[];
  /**
   * If a calendar-day deadline lands on a weekend or holiday, roll it forward to
   * the next business day. True by default — this is the common statutory rule
   * (e.g. California CPRA). Set false for jurisdictions that do not roll.
   */
  rollCalendarDeadlineToBusinessDay?: boolean;
  /**
   * Optional extension to apply on top of the initial deadline. Validated
   * against the clock's extension config; throws if the extension is not
   * permitted or exceeds the statutory maximum.
   */
  extension?: {
    days: number;
    reason?: string;
  };
}

export interface DueDateResult {
  /** The initial statutory due date (UTC-floored calendar date). */
  statutoryDueAt: Date;
  /** The effective due date after any applied extension (=== statutoryDueAt if none). */
  dueAt: Date;
  /** The date the clock actually began counting from. */
  clockStart: Date;
  dayType: "calendar" | "business";
  daysAllowed: number;
  extensionApplied?: {
    days: number;
    dayType: "calendar" | "business";
    reason?: string;
  };
  /** Human-readable explanation, suitable for the audit log (§5 RequestEvent). */
  basis: string;
}

/**
 * Compute the statutory response deadline for a request.
 *
 * Counting convention: the day the clock starts is day zero and is never
 * counted (see addBusinessDays). For "next_business_day" clocks, the clock
 * starts on the first business day on/after receipt.
 */
export function computeDueDate(args: ComputeDueDateArgs): DueDateResult {
  const {
    receivedAt,
    clock,
    holidays = [],
    rollCalendarDeadlineToBusinessDay = true,
    extension,
  } = args;

  if (Number.isNaN(receivedAt.getTime())) {
    throw new RangeError("computeDueDate: receivedAt is an invalid Date");
  }
  if (!Number.isInteger(clock.initialDays) || clock.initialDays < 0) {
    throw new RangeError(
      `computeDueDate: clock.initialDays must be a non-negative integer, got ${clock.initialDays}`,
    );
  }

  const hset = holidaySet(holidays);
  const received = utcDateFloor(receivedAt);

  // Where does the clock begin counting?
  const clockStart =
    clock.clockStartsOn === "next_business_day"
      ? rollForwardToBusinessDay(received, hset)
      : received;

  // Initial deadline.
  let statutoryDueAt: Date;
  if (clock.dayType === "business") {
    statutoryDueAt = addBusinessDays(clockStart, clock.initialDays, hset);
  } else {
    const raw = addUtcDays(clockStart, clock.initialDays);
    statutoryDueAt = rollCalendarDeadlineToBusinessDay
      ? rollForwardToBusinessDay(raw, hset)
      : raw;
  }

  const clockStartNote =
    clock.clockStartsOn === "next_business_day"
      ? `clock starting the next business day after receipt (${isoDate(clockStart)})`
      : `clock starting on receipt (${isoDate(clockStart)})`;

  let dueAt = statutoryDueAt;
  let extensionApplied: DueDateResult["extensionApplied"];
  let basis = `${clock.initialDays} ${clock.dayType} day(s), ${clockStartNote}. Due ${isoDate(statutoryDueAt)}.`;

  if (extension) {
    const ext = validateAndApplyExtension({
      base: statutoryDueAt,
      extensionConfig: clock.extension,
      requestedDays: extension.days,
      reason: extension.reason,
      holidays: hset,
      rollCalendarDeadlineToBusinessDay,
    });
    dueAt = ext.dueAt;
    extensionApplied = {
      days: extension.days,
      dayType: clock.extension.dayType,
      reason: extension.reason,
    };
    basis += ` Extended by ${extension.days} ${clock.extension.dayType} day(s)${
      extension.reason ? ` (${extension.reason})` : ""
    } to ${isoDate(dueAt)}.`;
  }

  return {
    statutoryDueAt,
    dueAt,
    clockStart,
    dayType: clock.dayType,
    daysAllowed: clock.initialDays,
    extensionApplied,
    basis,
  };
}

interface ApplyExtensionArgs {
  base: Date;
  extensionConfig: ResponseClock["extension"];
  requestedDays: number;
  reason?: string;
  holidays: Set<string>;
  rollCalendarDeadlineToBusinessDay: boolean;
}

function validateAndApplyExtension(args: ApplyExtensionArgs): { dueAt: Date } {
  const { base, extensionConfig, requestedDays, reason, holidays, rollCalendarDeadlineToBusinessDay } =
    args;

  if (!extensionConfig.allowed) {
    throw new Error("computeDueDate: statute does not permit an extension for this request");
  }
  if (!Number.isInteger(requestedDays) || requestedDays <= 0) {
    throw new RangeError(
      `computeDueDate: extension days must be a positive integer, got ${requestedDays}`,
    );
  }
  if (requestedDays > extensionConfig.maxDays) {
    throw new RangeError(
      `computeDueDate: requested extension of ${requestedDays} day(s) exceeds statutory maximum of ${extensionConfig.maxDays}`,
    );
  }
  if (
    reason !== undefined &&
    extensionConfig.permittedReasons.length > 0 &&
    !extensionConfig.permittedReasons.includes(reason)
  ) {
    throw new Error(
      `computeDueDate: "${reason}" is not a permitted extension reason (permitted: ${extensionConfig.permittedReasons.join(", ")})`,
    );
  }

  // The extension counts forward from the initial deadline.
  if (extensionConfig.dayType === "business") {
    return { dueAt: addBusinessDays(base, requestedDays, holidays) };
  }
  const raw = addUtcDays(base, requestedDays);
  return {
    dueAt: rollCalendarDeadlineToBusinessDay ? rollForwardToBusinessDay(raw, holidays) : raw,
  };
}

/** Convenience: is a request overdue relative to a reference instant? */
export function isOverdue(dueAt: Date, now: Date): boolean {
  // Due "by close of business" on dueAt's calendar day: overdue once we pass it.
  return utcDateFloor(now) > utcDateFloor(dueAt);
}

/** Convenience re-export so callers get calendar helpers from one module. */
export { isBusinessDay, nextBusinessDay, isoDate };
