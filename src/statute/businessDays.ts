/**
 * Business-day calendar primitives (spec §7).
 *
 * All arithmetic is done on UTC calendar dates. Deadlines in public-records law
 * are date-level ("respond within N days"), not instants, so we deliberately
 * strip time-of-day and operate on the date floor. The caller is responsible for
 * presenting the due date in the agency's local timezone (a due date means "by
 * close of business on this calendar day").
 *
 * Keeping these pure and UTC-only is what makes computeDueDate() deterministic
 * and heavily unit-testable — the single most testable piece of compliance
 * logic in the product (§7).
 */

/** Weekday numbers, UTC. */
const SATURDAY = 6;
const SUNDAY = 0;

/** Floor a Date to UTC midnight of its calendar day. */
export function utcDateFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Format a Date as an ISO calendar date ("YYYY-MM-DD") in UTC. */
export function isoDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Add `n` calendar days (may be negative) to a date, returning a new UTC-floored Date. */
export function addUtcDays(d: Date, n: number): Date {
  const base = utcDateFloor(d);
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n));
}

export function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === SATURDAY || day === SUNDAY;
}

/** Normalize a holiday list into a Set of "YYYY-MM-DD" strings for O(1) lookup. */
export function holidaySet(holidays: readonly string[] = []): Set<string> {
  return new Set(holidays);
}

export function isHoliday(d: Date, holidays: Set<string>): boolean {
  return holidays.has(isoDate(d));
}

/** A business day is a weekday that is not an observed holiday. */
export function isBusinessDay(d: Date, holidays: Set<string>): boolean {
  return !isWeekend(d) && !isHoliday(d, holidays);
}

/**
 * The first business day on or after `d`. If `d` is already a business day it is
 * returned unchanged (floored to UTC midnight).
 */
export function rollForwardToBusinessDay(d: Date, holidays: Set<string>): Date {
  let cursor = utcDateFloor(d);
  while (!isBusinessDay(cursor, holidays)) {
    cursor = addUtcDays(cursor, 1);
  }
  return cursor;
}

/** The first business day strictly after `d`. */
export function nextBusinessDay(d: Date, holidays: Set<string>): Date {
  return rollForwardToBusinessDay(addUtcDays(d, 1), holidays);
}

/**
 * The date that is `n` business days after `start`. `start` itself is never
 * counted (the day the clock starts is day zero), matching the standard
 * "day of receipt is not counted" convention. `n` must be a non-negative integer.
 */
export function addBusinessDays(start: Date, n: number, holidays: Set<string>): Date {
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`addBusinessDays: n must be a non-negative integer, got ${n}`);
  }
  let cursor = utcDateFloor(start);
  let counted = 0;
  while (counted < n) {
    cursor = addUtcDays(cursor, 1);
    if (isBusinessDay(cursor, holidays)) counted++;
  }
  return cursor;
}

/** Count business days in the closed interval [from, to] (inclusive of both ends). */
export function businessDaysBetween(from: Date, to: Date, holidays: Set<string>): number {
  let cursor = utcDateFloor(from);
  const end = utcDateFloor(to);
  if (cursor > end) return 0;
  let count = 0;
  while (cursor <= end) {
    if (isBusinessDay(cursor, holidays)) count++;
    cursor = addUtcDays(cursor, 1);
  }
  return count;
}
