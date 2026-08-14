/**
 * Transparency impact (docs/transparency-impact.md, big-ticket §6) — the
 * north-star math: is publishing working? Converges what the platform
 * already counts — requests received, deflections (never archive_miss,
 * the house rule), records published, demand patterns — into one
 * deterministic picture, plus a PROJECTION for each unmet demand cluster
 * stated with its arithmetic spelled out (computeDueDate's basis idiom:
 * every number checkable, nothing invented).
 *
 * Pure: no clock, no repo — `now` and rows come in as arguments.
 */
import type { DemandPattern, DemandSignal } from "./demandPatterns";

export interface ImpactRequestRow {
  rawText: string;
  interpretedScope: string | null;
  receivedAt: Date | null;
  createdAt: Date;
  publicId: string;
}

export interface ImpactDeflectionRow {
  kind: string;
  query: string | null;
  estimatedStaffHoursAvoided: number;
  createdAt: Date;
}

/**
 * The ONE builder of demand signals (command center card, disclosure sweep,
 * and the impact report all consume patterns mined from this) — extracted
 * so a second surface can never quietly diverge on what counts as demand.
 */
export function demandSignalsFrom(
  requests: ImpactRequestRow[],
  deflections: ImpactDeflectionRow[],
): DemandSignal[] {
  return [
    ...requests.map((r) => ({
      kind: "request" as const,
      text: r.interpretedScope ?? r.rawText,
      at: r.receivedAt ?? r.createdAt,
      ref: r.publicId,
    })),
    ...deflections
      .filter((d) => (d.query ?? "").trim().length >= 3)
      .map((d) => ({
        kind: d.kind === "archive_miss" ? ("archive_miss" as const) : ("deflection_query" as const),
        text: d.query!,
        at: d.createdAt,
      })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface MonthlyImpactRow {
  /** "2026-03" */
  month: string;
  requests: number;
  /** Real deflections only — archive_miss is demand signal, never ROI. */
  deflections: number;
  archiveMisses: number;
  hoursAvoided: number;
  /** Records added to the public archive that month (by record creation —
   *  the platform does not timestamp classification flips separately). */
  recordsPublished: number;
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Last `months` calendar months (default 6), oldest first, current included. */
export function monthlyImpact(input: {
  requests: { receivedAt: Date | null; createdAt: Date }[];
  deflections: { kind: string; estimatedStaffHoursAvoided: number; createdAt: Date }[];
  publishedDocs: { createdAt: Date }[];
  now: Date;
  months?: number;
}): MonthlyImpactRow[] {
  const months = input.months ?? 6;
  const rows = new Map<string, MonthlyImpactRow>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth() - i, 1));
    const key = monthKey(d);
    rows.set(key, { month: key, requests: 0, deflections: 0, archiveMisses: 0, hoursAvoided: 0, recordsPublished: 0 });
  }

  for (const r of input.requests) {
    const row = rows.get(monthKey(r.receivedAt ?? r.createdAt));
    if (row) row.requests += 1;
  }
  for (const d of input.deflections) {
    const row = rows.get(monthKey(d.createdAt));
    if (!row) continue;
    if (d.kind === "archive_miss") row.archiveMisses += 1;
    else {
      row.deflections += 1;
      row.hoursAvoided += d.estimatedStaffHoursAvoided;
    }
  }
  for (const doc of input.publishedDocs) {
    const row = rows.get(monthKey(doc.createdAt));
    if (row) row.recordsPublished += 1;
  }

  return [...rows.values()].map((r) => ({ ...r, hoursAvoided: Math.round(r.hoursAvoided * 10) / 10 }));
}

export interface PublicationOpportunity extends DemandPattern {
  /** Conservative staff-hours/quarter publishing this cluster would free. */
  projectedHours: number;
  /** The arithmetic, spelled out — every number in it is checkable. */
  basis: string;
}

/**
 * Conservative projection: each repeated REQUEST in a cluster, had the
 * records been published, would at minimum have been answered by citation
 * (the deflection log's answered_by_link rate — 1.0h). Misses and searches
 * are cited as further demand, not monetized: no double counting, since a
 * resident who searched, missed, and filed is already in the request count.
 */
export function projectOpportunities(
  patterns: DemandPattern[],
  hoursPerAnsweredRequest = 1.0,
): PublicationOpportunity[] {
  return patterns.map((p) => {
    const projectedHours = Math.round(p.requests * hoursPerAnsweredRequest * 10) / 10;
    const demandNote =
      p.misses + p.queries > 0
        ? `; ${p.misses + p.queries} search${p.misses + p.queries === 1 ? "" : "es"} (${p.misses} unanswered) signal further demand`
        : "";
    return {
      ...p,
      projectedHours,
      basis:
        `${p.requests} similar request${p.requests === 1 ? "" : "s"} in the window × ` +
        `${hoursPerAnsweredRequest} staff-hour${hoursPerAnsweredRequest === 1 ? "" : "s"} per request answered by citation ` +
        `≈ ${projectedHours} hours${demandNote}`,
    };
  });
}
