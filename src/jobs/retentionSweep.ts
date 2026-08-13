/**
 * Nightly retention warning (the proactive half of src/domain/retention.ts).
 * The request page already warns about ITS OWN review set; this sweep is the
 * agency-wide net — every document whose retention date is inside the warning
 * window (or already past) without a hold lands in the append-only admin log,
 * whether or not anyone opens the app. Display + log only: no automated
 * process touches a document's schedule or hold (that is a named human's
 * act, and destruction itself happens outside this system anyway).
 */
import type { Repository } from "@/services/repository";
import { documentsAtRetentionRisk } from "@/domain/retention";

export interface RetentionSweepResult {
  atRisk: number;
  summary: string;
}

/** Sweep one agency; append an admin event only when something is at risk. */
export async function runRetentionSweep(
  repo: Repository,
  agencyId: string,
  now: Date,
): Promise<RetentionSweepResult> {
  const docs = await repo.listDocumentsUnderRetention(agencyId);
  const flagged = documentsAtRetentionRisk(docs, now);
  if (flagged.length === 0) return { atRisk: 0, summary: "No documents near scheduled destruction" };

  const expired = flagged.filter(({ status }) => status.state === "eligible_for_destruction").length;
  const expiring = flagged.length - expired;
  const parts = [
    expired > 0 ? `${expired} past retention` : null,
    expiring > 0 ? `${expiring} within the warning window` : null,
  ].filter(Boolean);
  const summary = `${flagged.length} document(s) near or past scheduled destruction (${parts.join(", ")})`;

  await repo.appendAdminEvent({
    id: crypto.randomUUID(),
    agencyId,
    kind: "retention_sweep",
    actorLabel: "retention sweep",
    summary,
    payload: {
      documents: flagged.map(({ doc, status }) => ({
        id: doc.id,
        filename: doc.filename,
        retentionUntil: doc.retentionUntil?.toISOString() ?? null,
        state: status.state,
        daysRemaining: status.daysRemaining,
      })),
    },
    createdAt: now,
  });
  return { atRisk: flagged.length, summary };
}
