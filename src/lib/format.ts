/** Small display helpers shared across the UI. Pure, no I/O. */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Aug 6" (UTC). */
export function dateShort(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Signed calendar-day label relative to now, e.g. "in 2 days", "3 days overdue". */
export function daysLabel(daysRemaining: number): string {
  if (daysRemaining === 0) return "due today";
  if (daysRemaining > 0) return `due in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
  const n = -daysRemaining;
  return `${n} day${n === 1 ? "" : "s"} overdue`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  in_review: "In review",
  clarification_needed: "Needs clarification",
  in_progress: "In progress",
  records_review: "Records review",
  partially_fulfilled: "Partially fulfilled",
  fulfilled: "Fulfilled",
  denied: "Denied",
  referred: "Referred",
  withdrawn: "Withdrawn",
  closed: "Closed",
};

export function requestStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s_])\w/g, (m) => m.toUpperCase()).replace(/_/g, " ");
}
