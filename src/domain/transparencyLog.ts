/**
 * Public request log (transparency page) — pure projection.
 *
 * THE RULE: nothing about the requester crosses into a log entry. Not name,
 * not email, not requester id, not even requester type. And the subject line
 * is the STAFF-CURATED interpreted scope, never the raw filing text — raw
 * text is the requester's own words and routinely contains their personal
 * details ("my medical records", "my address at …"). A request that hasn't
 * been through triage yet shows a neutral placeholder.
 */
import type { RequestEntity } from "@/services/repository";
import { requestStatusLabel } from "@/lib/format";

export interface PublicLogEntry {
  publicId: string;
  subject: string;
  statusLabel: string;
  receivedOn: string; // ISO date
  closedOn: string | null;
  /** Business outcome timing, when closed and a deadline existed. */
  onTime: boolean | null;
}

export function toPublicLogEntry(r: RequestEntity): PublicLogEntry {
  return {
    publicId: r.publicId,
    // interpretedScope is set by staff accepting triage — curated wording.
    subject: r.interpretedScope?.trim() || "Awaiting review",
    statusLabel: requestStatusLabel(r.status),
    receivedOn: (r.receivedAt ?? r.createdAt).toISOString().slice(0, 10),
    closedOn: r.closedAt ? r.closedAt.toISOString().slice(0, 10) : null,
    onTime:
      r.closedAt && r.statutoryDueAt
        ? r.closedAt.getTime() <= r.statutoryDueAt.getTime()
        : null,
  };
}

export interface PublicLogSummary {
  total: number;
  open: number;
  closed: number;
  onTimeRate: number | null; // of closed requests with a deadline
  medianDaysToClose: number | null;
}

export function publicLogSummary(requests: RequestEntity[]): PublicLogSummary {
  const closed = requests.filter((r) => r.closedAt != null);
  const withDeadline = closed.filter((r) => r.statutoryDueAt != null);
  const onTime = withDeadline.filter((r) => r.closedAt!.getTime() <= r.statutoryDueAt!.getTime());
  const days = closed
    .map((r) => (r.closedAt!.getTime() - (r.receivedAt ?? r.createdAt).getTime()) / 86_400_000)
    .sort((a, b) => a - b);
  const median = days.length === 0 ? null : Math.round(days[Math.floor((days.length - 1) / 2)]!);
  return {
    total: requests.length,
    open: requests.length - closed.length,
    closed: closed.length,
    onTimeRate: withDeadline.length === 0 ? null : Math.round((onTime.length / withDeadline.length) * 100),
    medianDaysToClose: median,
  };
}
